//! Server-owned history; null values and missing buckets never become zero.
use crate::{Client, Error, ErrorCode, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
const SERIES: [&str; 4] = [
    "tps",
    "game_cpu_percent",
    "game_memory_bytes",
    "players_online",
];
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetricsHistoryRequest {
    pub series: Vec<String>,
    pub from: i64,
    pub to: i64,
    pub resolution: String,
    pub max_points: usize,
    pub after: Option<String>,
}
impl MetricsHistoryRequest {
    fn valid(&self) -> bool {
        let names: std::collections::BTreeSet<_> = self.series.iter().collect();
        !self.series.is_empty()
            && self.series.len() <= 4
            && names.len() == self.series.len()
            && self.series.iter().all(|s| SERIES.contains(&s.as_str()))
            && self.from >= 0
            && self.to >= self.from
            && self.to - self.from <= 1825 * 86400000
            && (1..=2000).contains(&self.max_points)
            && matches!(self.resolution.as_str(), "raw" | "5m" | "daily" | "auto")
            && (self.resolution != "raw" || self.to - self.from <= 7 * 86400000)
            && self
                .after
                .as_ref()
                .is_none_or(|a| a.parse::<i64>().is_ok_and(|n| n >= 0))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricColumn {
    pub avg: Vec<Option<f64>>,
    pub min: Vec<Option<f64>>,
    pub max: Vec<Option<f64>>,
    #[serde(alias = "known_count")]
    pub known_count: Vec<u64>,
    #[serde(alias = "unknown_count")]
    pub unknown_count: Vec<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsHistory {
    pub timestamps: Vec<i64>,
    pub series: BTreeMap<String, MetricColumn>,
    pub gaps: Vec<bool>,
    #[serde(alias = "tick_source")]
    pub tick_source: Vec<Option<String>>,
    pub resolution: String,
    #[serde(alias = "bucket_millis")]
    pub bucket_millis: i64,
    pub cursor: String,
    #[serde(alias = "retention_gap")]
    pub retention_gap: bool,
}
pub fn decode(mut value: serde_json::Value) -> Result<MetricsHistory> {
    let bad = || Error::new(ErrorCode::Unsupported);
    let cursor = value
        .get("cursor")
        .and_then(serde_json::Value::as_i64)
        .filter(|v| *v >= 0)
        .ok_or_else(bad)?;
    value["cursor"] = serde_json::json!(cursor.to_string());
    let history: MetricsHistory = serde_json::from_value(value).map_err(|_| bad())?;
    let n = history.timestamps.len();
    if n > 2000
        || history.gaps.len() != n
        || history.tick_source.len() != n
        || history.timestamps.windows(2).any(|w| w[1] <= w[0])
        || !matches!(history.resolution.as_str(), "raw" | "5m" | "daily")
    {
        return Err(bad());
    }
    for (name, c) in &history.series {
        if !SERIES.contains(&name.as_str())
            || [
                c.avg.len(),
                c.min.len(),
                c.max.len(),
                c.known_count.len(),
                c.unknown_count.len(),
            ]
            .into_iter()
            .any(|l| l != n)
            || c.avg
                .iter()
                .chain(&c.min)
                .chain(&c.max)
                .flatten()
                .any(|v| !v.is_finite() || *v < 0.0)
        {
            return Err(bad());
        }
    }
    Ok(history)
}
impl Client {
    pub async fn metrics_history(&self, request: MetricsHistoryRequest) -> Result<MetricsHistory> {
        if !request.valid() {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let mut path = format!(
            "metrics?series={}&from={}&to={}&resolution={}&max_points={}",
            request.series.join(","),
            request.from,
            request.to,
            request.resolution,
            request.max_points
        );
        if let Some(after) = request.after {
            path.push_str(&format!("&after={after}"));
        }
        decode(self.get(&path, true, "metrics.view").await?)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn history_keeps_nulls_gaps_and_aggregate_unknown_counts() {
        let value = json!({"timestamps":[10,20],"series":{"tps":{"avg":[20.0,null],"min":[19.8,null],"max":[20.0,null],"known_count":[1,0],"unknown_count":[0,1]}},"gaps":[false,true],"tick_source":["spark",null],"resolution":"5m","bucket_millis":300000,"cursor":42,"retention_gap":true});
        let mut value = value;
        value["series"]["game_cpu_percent"] = value["series"]["tps"].clone();
        let h = decode(value.clone()).unwrap();
        assert!(h.series.contains_key("game_cpu_percent"));
        assert_eq!(h.cursor, "42");
        assert_eq!(h.series["tps"].avg[1], None);
        assert_eq!(h.series["tps"].unknown_count[1], 1);
        let mut bad = value;
        bad["gaps"] = json!([]);
        assert!(decode(bad).is_err());
    }
    #[test]
    fn history_request_refuses_unbounded_ranges_or_arbitrary_series() {
        let mut r = MetricsHistoryRequest {
            series: vec!["tps".into()],
            from: 0,
            to: 1,
            resolution: "raw".into(),
            max_points: 2000,
            after: None,
        };
        assert!(r.valid());
        r.to = 8 * 86400000;
        assert!(!r.valid());
        r.to = 1;
        r.series = vec!["secret".into()];
        assert!(!r.valid());
    }
}
