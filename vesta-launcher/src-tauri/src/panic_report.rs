use std::any::Any;

pub(crate) fn payload_message(payload: &(dyn Any + Send)) -> &str {
    if let Some(message) = payload.downcast_ref::<&str>() {
        message
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.as_str()
    } else {
        "non-string panic payload"
    }
}

#[cfg(test)]
mod tests {
    use super::payload_message;

    #[test]
    fn reports_literal_and_formatted_panic_messages() {
        assert_eq!(payload_message(&"literal panic"), "literal panic");
        let message = format!("state() called before manage() for {}", "ServerManager");
        assert_eq!(payload_message(&message), message);
    }

    #[test]
    fn handles_non_string_payloads() {
        assert_eq!(payload_message(&42_u32), "non-string panic payload");
    }
}
