use crate::models::pinning::{NewPinnedPage, PinnedPage};
use crate::schema::pinned_page::dsl::*;
use crate::utils::db::get_vesta_conn;
use diesel::prelude::*;
use tauri::command;

#[command]
pub async fn get_pinned_pages() -> Result<Vec<PinnedPage>, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    pinned_page
        .order(order_index.asc())
        .load::<PinnedPage>(&mut conn)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn add_pinned_page(new_pin: NewPinnedPage) -> Result<PinnedPage, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    diesel::insert_into(pinned_page)
        .values(&new_pin)
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    pinned_page
        .order(id.desc())
        .first::<PinnedPage>(&mut conn)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn remove_pinned_page(pin_id: i32) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    diesel::delete(pinned_page.filter(id.eq(pin_id)))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn reorder_pinned_pages(pin_ids: Vec<i32>) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    conn.transaction::<_, diesel::result::Error, _>(|c| {
        for (index, pin_id) in pin_ids.iter().enumerate() {
            diesel::update(pinned_page.filter(id.eq(pin_id)))
                .set(order_index.eq(index as i32))
                .execute(c)?;
        }
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    Ok(())
}
