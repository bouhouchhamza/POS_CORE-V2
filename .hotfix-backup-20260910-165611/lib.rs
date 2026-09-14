mod product_images_generated;
#[derive(Debug, thiserror::Error)]
enum PrintError {
    #[error("Receipt payload is empty or too large")]
    InvalidPayload,
    #[error("Printer name is invalid")]
    InvalidPrinter,
    #[error("Native printing is available only on Windows builds")]
    Unsupported,
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
struct PrinterInfo {
    name: String,
    driver_name: String,
    port: String,
    is_default: bool,
}

fn is_virtual_printer(printer: &PrinterInfo) -> bool {
    let value = format!("{} {} {}", printer.name, printer.driver_name, printer.port).to_lowercase();

    [
        "microsoft print to pdf",
        "microsoft xps",
        "xps",
        "fax",
        "anydesk",
        "onenote",
        "pdf",
        "virtual",
    ]
    .iter()
    .any(|blocked| value.contains(blocked))
}

fn resolve_printer(
    printers: &[PrinterInfo],
    configured: Option<&str>,
) -> Result<PrinterInfo, String> {
    if let Some(configured) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(printer) = printers.iter().find(|printer| {
            printer.name.eq_ignore_ascii_case(configured) && !is_virtual_printer(printer)
        }) {
            return Ok(printer.clone());
        }
    }

    let eligible: Vec<&PrinterInfo> = printers
        .iter()
        .filter(|printer| !is_virtual_printer(printer))
        .collect();

    let strong: Vec<&PrinterInfo> = eligible
        .iter()
        .copied()
        .filter(|printer| {
            let value = format!("{} {}", printer.name, printer.driver_name).to_lowercase();
            value.contains("pos-80") || value.contains("pos80")
        })
        .collect();

    if strong.len() == 1 {
        return Ok(strong[0].clone());
    }
    if strong.len() > 1 {
        return Err("Plusieurs imprimantes POS-80 ont ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©tÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© dÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©tectÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©es. SÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©lectionnez-en une dans les paramÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨tres.".into());
    }

    let plausible: Vec<&PrinterInfo> = eligible
        .iter()
        .copied()
        .filter(|printer| {
            let value = format!("{} {}", printer.name, printer.driver_name).to_lowercase();
            (value.contains("thermal") || value.contains("receipt") || value.contains("ticket"))
                && (value.contains("80") || value.contains("pos"))
        })
        .collect();

    match plausible.as_slice() {
        [printer] => Ok((*printer).clone()),
        [] => Err("Aucune imprimante thermique POS-80 reconnue par Windows. Installez d'abord la file et le pilote POS-80.".into()),
        _ => Err("Plusieurs imprimantes thermiques possibles ont ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©tÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© dÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©tectÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©es. SÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©lectionnez-en une dans les paramÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨tres.".into()),
    }
}

use std::{
    io::{Read, Write},
    net::TcpStream,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent, WebviewWindow};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct LocalBackend(Mutex<Option<CommandChild>>);

const SEED_DB: &[u8] = include_bytes!("../resources/bimik-cafe.seed.sqlite");

fn startup_log(data_directory: &std::path::Path, message: &str) {
    let logs = data_directory.join("logs");
    if std::fs::create_dir_all(&logs).is_err() {
        return;
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join("desktop-startup.log"))
    {
        let _ = writeln!(file, "{message}");
    }
}

fn sqlite_companion_path(database: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    let mut value = database.as_os_str().to_os_string();
    value.push(suffix);
    std::path::PathBuf::from(value)
}

fn legacy_database_is_truly_empty(database: &std::path::Path) -> bool {
    use rusqlite::{Connection, OpenFlags};

    let connection = match Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(connection) => connection,
        Err(_) => return false,
    };

    let quick_check: String = match connection.query_row("PRAGMA quick_check", [], |row| row.get(0))
    {
        Ok(value) => value,
        Err(_) => return false,
    };

    if quick_check.to_ascii_lowercase() != "ok" {
        return false;
    }

    let mut statement = match connection.prepare(
        "SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name",
    ) {
        Ok(statement) => statement,
        Err(_) => return false,
    };

    let rows = match statement.query_map([], |row| row.get::<_, String>(0)) {
        Ok(rows) => rows,
        Err(_) => return false,
    };

    let mut tables = Vec::new();

    for row in rows {
        match row {
            Ok(name) => tables.push(name),
            Err(_) => return false,
        }
    }

    let fingerprints = [
        "users",
        "categories",
        "products",
        "sales",
        "sale_items",
        "cash_register_sessions",
        "stock_movements",
        "settings",
        "refresh_tokens",
    ];

    let has_users = tables.iter().any(|name| name == "users");
    let fingerprint_count = tables
        .iter()
        .filter(|name| fingerprints.contains(&name.as_str()))
        .count();

    // Unknown/unrelated/too-partial DB: preserve it.
    if !has_users || fingerprint_count < 2 {
        println!("Bimik Cafe: unrecognized database preserved");
        return false;
    }

    for table in &tables {
        let lower = table.to_ascii_lowercase();
        if lower.starts_with("sqlite_") || lower.contains("migration") {
            continue;
        }
        if !fingerprints.contains(&table.as_str())
            && table != "backup_status"
            && table != "menu_import_sessions"
        {
            println!("Bimik Cafe: unknown table {table}; database preserved");
            return false;
        }
    }

    // Absolute safety rule:
    // any row in any application table means preserve.
    for table in &tables {
        let lower = table.to_ascii_lowercase();
        if lower.starts_with("sqlite_") || lower.contains("migration") || lower == "backup_status" {
            continue;
        }

        let safe_name = table.replace('"', "\"\"");

        let sql = format!("SELECT COUNT(*) FROM \"{}\"", safe_name);

        let count: i64 = match connection.query_row(&sql, [], |row| row.get(0)) {
            Ok(count) => count,
            Err(_) => return false,
        };

        if count != 0 {
            println!(
                "Bimik Cafe: existing business data found in {}; database preserved",
                table
            );

            return false;
        }
    }

    println!("Bimik Cafe: recognized empty legacy database eligible for seed repair");

    true
}

fn restore_legacy_backup(database: &std::path::Path, backup: &std::path::Path) {
    let _ = std::fs::remove_file(database);
    let _ = std::fs::rename(backup, database);

    for suffix in ["-wal", "-shm", "-journal"] {
        let source = sqlite_companion_path(backup, suffix);
        let target = sqlite_companion_path(database, suffix);

        if source.exists() {
            let _ = std::fs::remove_file(&target);
            let _ = std::fs::rename(source, target);
        }
    }
}

fn validate_seed_database(database: &std::path::Path) -> Result<(), std::io::Error> {
    let invalid = |message: String| std::io::Error::new(std::io::ErrorKind::InvalidData, message);
    let connection =
        rusqlite::Connection::open_with_flags(database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| invalid(format!("Cannot open embedded seed: {error}")))?;
    let quick_check: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| invalid(format!("Seed quick_check failed: {error}")))?;
    if quick_check != "ok" {
        return Err(invalid(format!("Seed quick_check returned {quick_check}")));
    }
    for (table, expected) in [
        ("users", 2i64),
        ("categories", 10),
        ("products", 92),
        ("sales", 0),
        ("sale_items", 0),
        ("cash_register_sessions", 0),
        ("stock_movements", 0),
    ] {
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .map_err(|error| invalid(format!("Cannot validate seed table {table}: {error}")))?;
        if count != expected {
            return Err(invalid(format!(
                "Embedded seed {table} count is {count}; expected {expected}"
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Default, PartialEq, Eq)]
struct CatalogMigrationResult {
    categories_inserted: usize,
    products_inserted: usize,
}

/// Adds catalog rows introduced by a newer bundled release without changing any
/// row that already exists in the client's database. Stable approved IDs are the
/// only identity used here; existing mutable fields remain business-owned.
fn migrate_missing_approved_catalog(
    data_directory: &std::path::Path,
    database: &std::path::Path,
) -> Result<CatalogMigrationResult, String> {
    use rusqlite::{Connection, OpenFlags};

    let data_dir = data_directory.join("data");
    std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let approved_path = data_dir.join(format!(
        ".bimik-approved-catalog-{}.sqlite",
        std::process::id()
    ));

    if approved_path.exists() {
        std::fs::remove_file(&approved_path).map_err(|error| error.to_string())?;
    }

    let result = (|| -> Result<CatalogMigrationResult, String> {
        let mut approved_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&approved_path)
            .map_err(|error| error.to_string())?;
        approved_file
            .write_all(SEED_DB)
            .map_err(|error| error.to_string())?;
        approved_file
            .sync_all()
            .map_err(|error| error.to_string())?;
        drop(approved_file);

        validate_seed_database(&approved_path).map_err(|error| error.to_string())?;

        let approved = Connection::open_with_flags(
            &approved_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| error.to_string())?;

        let categories = {
            let mut statement = approved
                .prepare(
                    "SELECT id,name,image,created_at,updated_at
                     FROM categories ORDER BY id",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };

        let products = {
            let mut statement = approved
                .prepare(
                    "SELECT id,category_id,name,purchase_price_cents,sale_price_cents,
                            stock,min_stock,track_stock,image,is_active,created_at,updated_at
                     FROM products ORDER BY id",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, String>(11)?,
                    ))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        drop(approved);

        let mut target = Connection::open(database).map_err(|error| error.to_string())?;
        target
            .pragma_update(None, "foreign_keys", true)
            .map_err(|error| error.to_string())?;
        let transaction = target.transaction().map_err(|error| error.to_string())?;
        let mut outcome = CatalogMigrationResult::default();

        for (id, name, image, created_at, updated_at) in categories {
            outcome.categories_inserted += transaction
                .execute(
                    "INSERT INTO categories(id,name,image,created_at,updated_at)
                     SELECT ?,?,?,?,?
                     WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id=?)",
                    rusqlite::params![id, name, image, created_at, updated_at, id],
                )
                .map_err(|error| error.to_string())?;
        }

        for (
            id,
            category_id,
            name,
            purchase_price_cents,
            sale_price_cents,
            stock,
            min_stock,
            track_stock,
            image,
            is_active,
            created_at,
            updated_at,
        ) in products
        {
            outcome.products_inserted += transaction
                .execute(
                    "INSERT INTO products(
                         id,category_id,name,purchase_price_cents,sale_price_cents,
                         stock,min_stock,track_stock,image,is_active,created_at,updated_at
                     )
                     SELECT ?,?,?,?,?,?,?,?,?,?,?,?
                     WHERE NOT EXISTS (SELECT 1 FROM products WHERE id=?)",
                    rusqlite::params![
                        id,
                        category_id,
                        name,
                        purchase_price_cents,
                        sale_price_cents,
                        stock,
                        min_stock,
                        track_stock,
                        image,
                        is_active,
                        created_at,
                        updated_at,
                        id,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }

        transaction.commit().map_err(|error| error.to_string())?;
        Ok(outcome)
    })();

    let cleanup_result = std::fs::remove_file(&approved_path);
    match (result, cleanup_result) {
        (Ok(value), Ok(())) => Ok(value),
        (Ok(_), Err(error)) => Err(format!(
            "Impossible de supprimer la copie temporaire du catalogue: {error}"
        )),
        (Err(error), _) => Err(error),
    }
}

fn provision_product_images(
    data_directory: &std::path::Path,
    database: &std::path::Path,
) -> Result<(usize, usize, usize), String> {
    use rusqlite::OptionalExtension;
    use std::io::Write;

    let uploads = data_directory.join("uploads").join("products");

    std::fs::create_dir_all(&uploads)
        .map_err(|error| format!("Impossible de crÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©er le dossier images: {error}"))?;

    let mut connection = rusqlite::Connection::open(database)
        .map_err(|error| format!("Impossible d'ouvrir SQLite pour les images: {error}"))?;

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    let mut copied = 0usize;
    let mut linked = 0usize;
    let mut preserved = 0usize;

    for asset in product_images_generated::PRODUCT_IMAGES {
        let existing: Option<Option<String>> = transaction
            .query_row(
                "SELECT image
                     FROM products
                     WHERE id=?",
                [asset.product_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;

        let Some(current_image) = existing else {
            // Existing client databases may no longer
            // contain every original seed product.
            continue;
        };

        let current = current_image.as_deref().unwrap_or("").trim();
        let lineage_prefix = format!("/uploads/products/bimik-bundled-{:03}_", asset.product_id);

        // An empty/NULL image means the product has no business-owned image,
        // so the approved bundled image is a safe default.
        // Any non-empty URL outside this stable app-owned lineage is customer
        // data and must never be overwritten.
        if !current.is_empty() && !current.starts_with(&lineage_prefix) {
            preserved += 1;
            continue;
        }

        let target = uploads.join(asset.file_name);

        if target.exists() && !target.is_file() {
            return Err(format!(
                "Le chemin image existe mais n'est pas un fichier: {}",
                target.display()
            ));
        }

        let target_needs_refresh = if target.is_file() {
            let installed_bytes = std::fs::read(&target).map_err(|error| {
                format!(
                    "Impossible de lire l'image installÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©e pour {} ({}): {error}",
                    asset.product_name,
                    target.display(),
                )
            })?;

            installed_bytes.as_slice() != asset.bytes
        } else {
            true
        };

        if target_needs_refresh {
            let temporary =
                uploads.join(format!(".{}.{}.tmp", asset.file_name, std::process::id()));

            if temporary.exists() {
                let _ = std::fs::remove_file(&temporary);
            }

            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| {
                    format!("Impossible de prÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©parer {}: {error}", temporary.display())
                })?;

            file.write_all(asset.bytes)
                .map_err(|error| error.to_string())?;

            file.sync_all().map_err(|error| error.to_string())?;

            drop(file);

            std::fs::copy(&temporary, &target).map_err(|error| {
                format!("Impossible de mettre ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  jour {}: {error}", target.display())
            })?;

            let _ = std::fs::remove_file(&temporary);

            copied += 1;
        }

        if current != asset.image_url {
            let changed = transaction
                .execute(
                    "UPDATE products
                         SET image=?
                         WHERE id=?
                           AND COALESCE(TRIM(image), '')=?",
                    rusqlite::params![asset.image_url, asset.product_id, current,],
                )
                .map_err(|error| error.to_string())?;

            linked += changed;
        }
    }

    transaction.commit().map_err(|error| error.to_string())?;

    Ok((copied, linked, preserved))
}

fn ensure_seed_database(data_directory: &std::path::Path) -> Result<bool, std::io::Error> {
    let data_dir = data_directory.join("data");
    std::fs::create_dir_all(&data_dir)?;

    let database = data_dir.join("bimik-cafe.sqlite");

    let replacing_legacy_empty = if database.exists() {
        if legacy_database_is_truly_empty(&database) {
            println!(
                "Bimik Cafe: unused legacy database detected; preparing automatic seed repair"
            );
            true
        } else {
            println!("Bimik Cafe: existing database preserved");
            return Ok(false);
        }
    } else {
        false
    };

    let temporary = data_dir.join(format!(
        ".bimik-cafe.sqlite.seed-{}.tmp",
        std::process::id()
    ));

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;

    file.write_all(SEED_DB)?;
    file.sync_all()?;
    drop(file);

    if let Err(error) = validate_seed_database(&temporary) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }

    if !replacing_legacy_empty {
        if let Err(error) = std::fs::rename(&temporary, &database) {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }

        println!("Bimik Cafe: first-run seed database installed");

        return Ok(true);
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let backup = data_dir.join(format!("bimik-cafe.sqlite.legacy-empty-{stamp}.bak"));

    std::fs::rename(&database, &backup)?;

    let mut moved_companions: Vec<&str> = Vec::new();

    for suffix in ["-wal", "-shm", "-journal"] {
        let source = sqlite_companion_path(&database, suffix);

        if !source.exists() {
            continue;
        }

        let target = sqlite_companion_path(&backup, suffix);

        if let Err(error) = std::fs::rename(&source, &target) {
            for moved in moved_companions.iter().rev() {
                let from = sqlite_companion_path(&backup, moved);
                let to = sqlite_companion_path(&database, moved);

                let _ = std::fs::rename(from, to);
            }

            let _ = std::fs::rename(&backup, &database);

            let _ = std::fs::remove_file(&temporary);

            return Err(error);
        }

        moved_companions.push(suffix);
    }

    if let Err(error) = std::fs::rename(&temporary, &database) {
        restore_legacy_backup(&database, &backup);

        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }

    println!("Bimik Cafe: unused legacy database repaired automatically from embedded seed");

    Ok(true)
}

fn focus_main_window(window: Option<WebviewWindow>) {
    if let Some(window) = window {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn wait_for_local_api(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(mut stream) = TcpStream::connect_timeout(
            &"127.0.0.1:32145".parse().expect("valid loopback address"),
            Duration::from_millis(300),
        ) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            if stream
                .write_all(b"GET /ready HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .is_ok()
            {
                let mut response = [0_u8; 128];
                if let Ok(size) = stream.read(&mut response) {
                    if String::from_utf8_lossy(&response[..size]).contains(" 200 ") {
                        return true;
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
    false
}

fn cp850_receipt(text: &str) -> Vec<u8> {
    let mut result = vec![0x1b, 0x40, 0x1b, 0x74, 0x02];
    result.extend(text.chars().map(|character| match character {
        '\u{00e9}' => 0x82,
        '\u{00e2}' => 0x83,
        '\u{00e4}' => 0x84,
        '\u{00e0}' => 0x85,
        '\u{00e7}' => 0x87,
        '\u{00ea}' => 0x88,
        '\u{00eb}' => 0x89,
        '\u{00e8}' => 0x8a,
        '\u{00ef}' => 0x8b,
        '\u{00ee}' => 0x8c,
        '\u{00c9}' => 0x90,
        '\u{00f4}' => 0x93,
        '\u{00f6}' => 0x94,
        '\u{00fb}' => 0x96,
        '\u{00f9}' => 0x97,
        '\u{00ff}' => 0x98,
        '\u{00d6}' => 0x99,
        '\u{00dc}' => 0x9a,
        '\u{00a2}' => 0xbd,
        '\u{00c7}' => 0x80,
        value if value.is_ascii() => value as u8,
        _ => b'?',
    }));
    result
}

fn valid_escpos_raster(bytes: &[u8]) -> bool {
    if bytes.len() < 10 || bytes[..6] != [0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00] {
        return false;
    }

    let width_bytes = u16::from_le_bytes([bytes[6], bytes[7]]) as usize;
    let height = u16::from_le_bytes([bytes[8], bytes[9]]) as usize;

    if width_bytes == 0 || width_bytes > 128 || height == 0 || height > 16_000 {
        return false;
    }

    let data_len = match width_bytes.checked_mul(height) {
        Some(value) => value,
        None => return false,
    };
    let expected = match 10usize.checked_add(data_len) {
        Some(value) => value,
        None => return false,
    };

    expected == bytes.len() && expected <= 2 * 1024 * 1024
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct StoredLicenseDeviceIdentity {
    installation_id: String,
    public_key: String,
    private_key: String,
}

#[derive(Clone, Debug, serde::Serialize)]
struct LicenseDeviceIdentity {
    installation_id: String,
    public_key: String,
}

const LICENSE_CREDENTIAL_SERVICE: &str = "Core POS License";
const LICENSE_CREDENTIAL_ACCOUNT: &str = "device-identity-v1";

#[cfg(windows)]
fn license_credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        LICENSE_CREDENTIAL_SERVICE,
        LICENSE_CREDENTIAL_ACCOUNT,
    )
    .map_err(|error| format!("Impossible d'ouvrir le stockage securise Windows: {error}"))
}

#[tauri::command]
fn save_license_device_identity(
    installation_id: String,
    public_key: String,
    private_key: String,
) -> Result<LicenseDeviceIdentity, String> {
    let installation_id = installation_id.trim().to_string();

    if installation_id.is_empty()
        || installation_id.len() > 100
        || public_key.len() < 40
        || public_key.len() > 5000
        || private_key.len() < 40
        || private_key.len() > 10000
    {
        return Err("Identite d'appareil invalide.".into());
    }

    #[cfg(windows)]
    {
        let stored = StoredLicenseDeviceIdentity {
            installation_id: installation_id.clone(),
            public_key: public_key.clone(),
            private_key,
        };

        let serialized = serde_json::to_string(&stored)
            .map_err(|error| format!("Impossible de serialiser l'identite: {error}"))?;

        license_credential_entry()?
            .set_password(&serialized)
            .map_err(|error| format!("Impossible d'enregistrer l'identite securisee: {error}"))?;

        return Ok(LicenseDeviceIdentity {
            installation_id,
            public_key,
        });
    }

    #[cfg(not(windows))]
    {
        let _ = private_key;
        Err("Le stockage securise de licence est disponible uniquement sur Windows.".into())
    }
}

#[tauri::command]
fn load_license_device_identity() -> Result<Option<LicenseDeviceIdentity>, String> {
    #[cfg(windows)]
    {
        let raw = match license_credential_entry()?.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(error) => {
                return Err(format!(
                    "Impossible de lire l'identite securisee Windows: {error}"
                ))
            }
        };

        let stored: StoredLicenseDeviceIdentity = serde_json::from_str(&raw)
            .map_err(|error| format!("Identite securisee invalide: {error}"))?;

        if stored.installation_id.trim().is_empty()
            || stored.public_key.len() < 40
            || stored.private_key.len() < 40
        {
            return Err("Identite securisee incomplete.".into());
        }

        return Ok(Some(LicenseDeviceIdentity {
            installation_id: stored.installation_id,
            public_key: stored.public_key,
        }));
    }

    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

#[derive(serde::Deserialize)]
struct Ed25519PrivateJwk {
    kty: String,
    crv: String,
    d: String,
}

#[derive(serde::Deserialize)]
struct Ed25519PublicJwk {
    kty: String,
    crv: String,
    x: String,
}

#[tauri::command]
fn sign_license_device_payload(payload: String) -> Result<String, String> {
    if payload.is_empty() || payload.len() > 64 * 1024 {
        return Err("Payload de licence invalide.".into());
    }

    #[cfg(windows)]
    {
        use base64::{
            engine::general_purpose::URL_SAFE_NO_PAD,
            Engine as _,
        };
        use ed25519_dalek::{Signer, SigningKey};

        let raw = license_credential_entry()?
            .get_password()
            .map_err(|error| {
                format!("Identite securisee introuvable: {error}")
            })?;

        let stored: StoredLicenseDeviceIdentity =
            serde_json::from_str(&raw)
                .map_err(|error| {
                    format!("Identite securisee invalide: {error}")
                })?;

        let private_jwk: Ed25519PrivateJwk =
            serde_json::from_str(&stored.private_key)
                .map_err(|error| {
                    format!("Cle privee Ed25519 invalide: {error}")
                })?;

        let public_jwk: Ed25519PublicJwk =
            serde_json::from_str(&stored.public_key)
                .map_err(|error| {
                    format!("Cle publique Ed25519 invalide: {error}")
                })?;

        if private_jwk.kty != "OKP"
            || private_jwk.crv != "Ed25519"
            || public_jwk.kty != "OKP"
            || public_jwk.crv != "Ed25519"
        {
            return Err("Format de cle Ed25519 invalide.".into());
        }

        let private_bytes = URL_SAFE_NO_PAD
            .decode(private_jwk.d.as_bytes())
            .map_err(|_| "Cle privee Ed25519 invalide.".to_string())?;

        let private_bytes: [u8; 32] = private_bytes
            .try_into()
            .map_err(|_| "Longueur de cle privee Ed25519 invalide.".to_string())?;

        let signing_key = SigningKey::from_bytes(&private_bytes);

        let expected_public = URL_SAFE_NO_PAD
            .decode(public_jwk.x.as_bytes())
            .map_err(|_| "Cle publique Ed25519 invalide.".to_string())?;

        if expected_public.as_slice()
            != signing_key.verifying_key().as_bytes()
        {
            return Err(
                "La cle privee ne correspond pas a la cle publique.".into(),
            );
        }

        let signature = signing_key.sign(payload.as_bytes());

        return Ok(
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        );
    }

    #[cfg(not(windows))]
    {
        Err("La signature materielle est disponible uniquement sur Windows.".into())
    }
}
#[tauri::command]
fn print_receipt(printer_name: String, receipt_text: String, copies: u8) -> Result<(), String> {
    if printer_name.trim().is_empty()
        || printer_name.len() > 255
        || printer_name
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        return Err(PrintError::InvalidPrinter.to_string());
    }
    if receipt_text.is_empty() || receipt_text.len() > 64 * 1024 || !(1..=2).contains(&copies) {
        return Err(PrintError::InvalidPayload.to_string());
    }
    #[cfg(windows)]
    {
        return windows_print::print(&printer_name, &cp850_receipt(&receipt_text), copies)
            .map_err(|error| error.to_string());
    }
    #[cfg(not(windows))]
    {
        Err(PrintError::Unsupported.to_string())
    }
}

#[tauri::command]
fn print_receipt_raster(
    printer_name: String,
    raster_base64: String,
    copies: u8,
) -> Result<(), String> {
    if printer_name.trim().is_empty()
        || printer_name.len() > 255
        || printer_name
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        return Err(PrintError::InvalidPrinter.to_string());
    }

    if raster_base64.is_empty()
        || raster_base64.len() > 3 * 1024 * 1024
        || !(1..=2).contains(&copies)
    {
        return Err(PrintError::InvalidPayload.to_string());
    }

    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let bytes = STANDARD
        .decode(raster_base64.as_bytes())
        .map_err(|_| PrintError::InvalidPayload.to_string())?;

    if !valid_escpos_raster(&bytes) {
        return Err(PrintError::InvalidPayload.to_string());
    }

    #[cfg(windows)]
    {
        return windows_print::print(&printer_name, &bytes, copies)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(windows))]
    {
        Err(PrintError::Unsupported.to_string())
    }
}

#[tauri::command]
fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    #[cfg(windows)]
    {
        windows_print::list().map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        Err(PrintError::Unsupported.to_string())
    }
}

#[tauri::command]
fn resolve_thermal_printer(configured_printer: Option<String>) -> Result<PrinterInfo, String> {
    let printers = list_printers()?;
    resolve_printer(&printers, configured_printer.as_deref())
}

#[tauri::command]
fn show_touch_keyboard() -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_touch_keyboard::show();
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(windows)]
mod windows_touch_keyboard {
    use std::{
        ffi::c_void,
        os::windows::process::CommandExt,
        path::PathBuf,
        process::Command,
        sync::{Mutex, OnceLock},
        time::{Duration, Instant},
    };

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const REQUEST_COOLDOWN: Duration = Duration::from_millis(750);
    static LAST_REQUEST: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

    use windows::{
        core::{Interface, GUID, HRESULT},
        Win32::{
            Foundation::HWND,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_HANDLER,
                CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::WindowsAndMessaging::{FindWindowW, GetForegroundWindow, IsWindowVisible},
        },
    };

    windows::core::imp::define_interface!(
        ITipInvocation,
        ITipInvocation_Vtbl,
        0x37c994e7_432b_4834_a2f7_dce1f13b834b
    );

    #[repr(C)]
    pub struct ITipInvocation_Vtbl {
        base__: windows::core::IUnknown_Vtbl,
        toggle: unsafe extern "system" fn(*mut c_void, HWND) -> HRESULT,
    }

    impl ITipInvocation {
        unsafe fn toggle(&self, window: HWND) -> windows::core::Result<()> {
            (Interface::vtable(self).toggle)(Interface::as_raw(self), window).ok()
        }
    }

    fn keyboard_is_visible() -> bool {
        unsafe {
            let class_name: Vec<u16> = "IPTip_Main_Window\0".encode_utf16().collect();
            FindWindowW(windows::core::PCWSTR(class_name.as_ptr()), None)
                .is_ok_and(|window| !window.is_invalid() && IsWindowVisible(window).as_bool())
        }
    }

    fn invoke_touch_keyboard() -> Result<(), String> {
        const CLSID_UI_HOST_NO_LAUNCH: GUID =
            GUID::from_u128(0x4ce576fa_83dc_4f88_951c_9d0782b4e376);

        unsafe {
            let initialization = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let should_uninitialize = initialization.is_ok();
            let invocation = CoCreateInstance::<_, ITipInvocation>(
                &CLSID_UI_HOST_NO_LAUNCH,
                None,
                CLSCTX_INPROC_HANDLER | CLSCTX_LOCAL_SERVER,
            );
            let result = invocation.and_then(|value| value.toggle(GetForegroundWindow()));
            if should_uninitialize {
                CoUninitialize();
            }
            result.map_err(|error| error.to_string())
        }
    }

    fn tab_tip_path() -> Result<PathBuf, String> {
        let common_program_files = std::env::var_os("CommonProgramW6432")
            .or_else(|| std::env::var_os("CommonProgramFiles"))
            .ok_or_else(|| "Le dossier Windows Common Files est introuvable.".to_string())?;
        let path = PathBuf::from(common_program_files)
            .join("microsoft shared")
            .join("ink")
            .join("TabTip.exe");

        if !path.is_file() {
            return Err("Le clavier tactile Windows est indisponible.".to_string());
        }

        Ok(path)
    }

    pub fn show() -> Result<(), String> {
        let now = Instant::now();
        let requests = LAST_REQUEST.get_or_init(|| Mutex::new(None));
        let mut last = requests.lock().map_err(|_| {
            "Le clavier tactile Windows est momentanÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©ment indisponible.".to_string()
        })?;

        if last.is_some_and(|previous| now.duration_since(previous) < REQUEST_COOLDOWN) {
            return Ok(());
        }

        if keyboard_is_visible() {
            *last = Some(now);
            return Ok(());
        }

        // COM can re-open the panel when the singleton TabTip process already
        // exists but is hidden. Starting TabTip remains a safe fallback.
        if invoke_touch_keyboard().is_err() {
            let path = tab_tip_path()?;
            Command::new(path)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|error| {
                    format!("Impossible d'ouvrir le clavier tactile Windows: {error}")
                })?;
        }
        *last = Some(now);
        Ok(())
    }
}

#[cfg(windows)]
mod windows_print {
    use std::{ffi::c_void, ptr};
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::Graphics::Printing::{
            ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW,
            OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
            PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
        },
    };

    use super::PrinterInfo;

    const FEED_AND_PARTIAL_CUT: &[u8] = &[0x1b, 0x64, 0x03, 0x1d, 0x56, 0x01];

    unsafe fn wide_string(value: PWSTR) -> String {
        if value.is_null() {
            String::new()
        } else {
            value.to_string().unwrap_or_default()
        }
    }

    unsafe fn default_printer_name() -> String {
        let mut required = 0u32;
        let _ = GetDefaultPrinterW(None, &mut required);
        if required == 0 {
            return String::new();
        }
        let mut buffer = vec![0u16; required as usize];
        if GetDefaultPrinterW(Some(PWSTR(buffer.as_mut_ptr())), &mut required).as_bool() {
            String::from_utf16_lossy(
                &buffer[..buffer
                    .iter()
                    .position(|value| *value == 0)
                    .unwrap_or(buffer.len())],
            )
        } else {
            String::new()
        }
    }

    pub fn list() -> Result<Vec<PrinterInfo>, Box<dyn std::error::Error>> {
        unsafe {
            let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
            let mut needed = 0u32;
            let mut returned = 0u32;
            let _ = EnumPrintersW(flags, PCWSTR::null(), 2, None, &mut needed, &mut returned);
            if needed == 0 {
                return Ok(Vec::new());
            }

            let words =
                (needed as usize + std::mem::size_of::<usize>() - 1) / std::mem::size_of::<usize>();
            let mut storage = vec![0usize; words];
            let bytes = std::slice::from_raw_parts_mut(
                storage.as_mut_ptr() as *mut u8,
                storage.len() * std::mem::size_of::<usize>(),
            );
            EnumPrintersW(
                flags,
                PCWSTR::null(),
                2,
                Some(bytes),
                &mut needed,
                &mut returned,
            )?;

            let default_name = default_printer_name();
            let records = std::slice::from_raw_parts(
                storage.as_ptr() as *const PRINTER_INFO_2W,
                returned as usize,
            );

            Ok(records
                .iter()
                .map(|record| {
                    let name = wide_string(record.pPrinterName);
                    PrinterInfo {
                        is_default: name.eq_ignore_ascii_case(&default_name),
                        name,
                        driver_name: wide_string(record.pDriverName),
                        port: wide_string(record.pPortName),
                    }
                })
                .collect())
        }
    }

    pub fn print(name: &str, bytes: &[u8], copies: u8) -> Result<(), Box<dyn std::error::Error>> {
        unsafe {
            let printer_name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
            let mut handle = Default::default();
            OpenPrinterW(PCWSTR(printer_name.as_ptr()), &mut handle, None)?;
            let document_name: Vec<u16> = "Bimik Cafe receipt\0".encode_utf16().collect();
            let data_type: Vec<u16> = "RAW\0".encode_utf16().collect();
            let document = DOC_INFO_1W {
                pDocName: PWSTR(document_name.as_ptr() as *mut _),
                pOutputFile: PWSTR(ptr::null_mut()),
                pDatatype: PWSTR(data_type.as_ptr() as *mut _),
            };
            if StartDocPrinterW(handle, 1, &document) == 0 {
                let _ = ClosePrinter(handle);
                return Err("StartDocPrinter failed".into());
            }
            let write_all = |payload: &[u8]| -> Result<(), Box<dyn std::error::Error>> {
                let mut offset = 0usize;

                while offset < payload.len() {
                    let remaining = payload.len() - offset;
                    let chunk_len = remaining.min(u32::MAX as usize);
                    let mut written = 0u32;
                    let write_ok = WritePrinter(
                        handle,
                        payload[offset..].as_ptr() as *const c_void,
                        chunk_len as u32,
                        &mut written,
                    )
                    .as_bool();

                    if !write_ok || written == 0 {
                        return Err("Printer write failed".into());
                    }

                    offset += written as usize;
                }

                Ok(())
            };
            for _ in 0..copies {
                if !StartPagePrinter(handle).as_bool() {
                    let _ = EndDocPrinter(handle);
                    let _ = ClosePrinter(handle);
                    return Err("StartPagePrinter failed".into());
                }
                if let Err(error) = write_all(bytes).and_then(|_| write_all(FEED_AND_PARTIAL_CUT)) {
                    let _ = EndPagePrinter(handle);
                    let _ = EndDocPrinter(handle);
                    let _ = ClosePrinter(handle);
                    return Err(error);
                }

                let page_ok = EndPagePrinter(handle).as_bool();

                if !page_ok {
                    let _ = EndDocPrinter(handle);
                    let _ = ClosePrinter(handle);

                    return Err("EndPagePrinter failed".into());
                }
            }
            let document_ok = EndDocPrinter(handle).as_bool();
            let _ = ClosePrinter(handle);
            if !document_ok {
                return Err("EndDocPrinter failed".into());
            }
            Ok(())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _arguments, _cwd| {
            focus_main_window(app.get_webview_window("main"));
        }))
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_directory)?;
            let database = data_directory.join("data").join("bimik-cafe.sqlite");
            let existed_before = database.exists();
            println!("Bimik Cafe: Tauri app_data_dir={}", data_directory.display());
            println!("Bimik Cafe: intended SQLite={}", database.display());
            startup_log(&data_directory, &format!("app_data_dir={}", data_directory.display()));
            startup_log(&data_directory, &format!("intended_sqlite={}", database.display()));
            let changed = ensure_seed_database(&data_directory)?;
            if !database.is_file() {
                return Err(format!("La base SQLite attendue n'existe pas aprÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨s le provisioning : {}", database.display()).into());
            }
            let provisioning = match (existed_before, changed) {
                (false, true) => "installed",
                (true, true) => "repaired-with-backup",
                _ => "preserved",
            };
            println!("Bimik Cafe: database provisioning={provisioning}");
            println!("Bimik Cafe: passing SQLite path to sidecar={}", database.display());
            startup_log(&data_directory, &format!("database_provisioning={provisioning}"));
            startup_log(&data_directory, &format!("sidecar_sqlite={}", database.display()));
            let catalog = migrate_missing_approved_catalog(&data_directory, &database)
                .map_err(|error| format!("La mise a jour sure du catalogue a echoue: {error}"))?;
            let catalog_message = format!(
                "catalog_migration categories_inserted={} products_inserted={}",
                catalog.categories_inserted, catalog.products_inserted
            );
            println!("Bimik Cafe: {catalog_message}");
            startup_log(&data_directory, &catalog_message);
            match provision_product_images(
                &data_directory,
                &database,
            ) {
                Ok((copied, linked, preserved)) => {
                    let message = format!(
                        "product_images copied={copied} linked={linked} custom_preserved={preserved}"
                    );
                    println!("Bimik Cafe: {message}");
                    startup_log(
                        &data_directory,
                        &message,
                    );
                }
                Err(error) => {
                    // Images must never prevent the POS
                    // from starting or endanger business data.
                    eprintln!(
                        "Bimik Cafe: product image provisioning failed: {error}"
                    );
                    startup_log(
                        &data_directory,
                        &format!(
                            "product_images_error={error}"
                        ),
                    );
                }
            }


            let mut sidecar = app
                .shell()
                .sidecar("bimik-local-api")?
                .env("BIMIK_APP_DATA_DIR", &data_directory)
                .env("BIMIK_DATABASE_PATH", &database)
                .env("BIMIK_LOCAL_PORT", "32145")
                .env("BIMIK_SIDECAR", "1");

            let license_server_url = std::env::var("LICENSE_SERVER_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| option_env!("LICENSE_SERVER_URL").map(str::to_owned));
            if let Some(value) = license_server_url {
                sidecar = sidecar.env("LICENSE_SERVER_URL", value.trim());
            }

            let license_public_key =
                std::env::var("LICENSE_SIGNING_PUBLIC_KEY")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
                    .or_else(|| {
                        option_env!("LICENSE_SIGNING_PUBLIC_KEY")
                            .map(str::to_owned)
                    });
            if let Some(value) = license_public_key {
                sidecar = sidecar.env(
                    "LICENSE_SIGNING_PUBLIC_KEY",
                    value.trim(),
                );
            }

            let (_events, child) = sidecar.spawn()?;
            if !wait_for_local_api(Duration::from_secs(15)) {
                let _ = child.kill();
                startup_log(&data_directory, "sidecar_ready=false");
                return Err("Le service local Bimik Cafe n'a pas dÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©marrÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©. Aucune donnÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©e n'a ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©tÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© modifiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©e.".into());
            }
            startup_log(&data_directory, "sidecar_ready=true");
            app.manage(LocalBackend(Mutex::new(Some(child))));
            focus_main_window(app.get_webview_window("main"));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            print_receipt,
            print_receipt_raster,
            list_printers,
            resolve_thermal_printer,
            show_touch_keyboard,
            save_license_device_identity,
            load_license_device_identity,
            sign_license_device_payload
        ])
        .build(tauri::generate_context!())
        .expect("error while building Bimik Cafe");
    application.run(|app, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(state) = app.try_state::<LocalBackend>() {
                if let Ok(mut backend) = state.0.lock() {
                    if let Some(child) = backend.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OptionalExtension;

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "bimik-cafe-test-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn create_known_empty_database(path: &std::path::Path, with_user: bool) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let connection = rusqlite::Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE categories (id INTEGER PRIMARY KEY);
             CREATE TABLE products (id INTEGER PRIMARY KEY);
             CREATE TABLE cash_register_sessions (id INTEGER PRIMARY KEY);
             CREATE TABLE sales (id INTEGER PRIMARY KEY);
             CREATE TABLE sale_items (id INTEGER PRIMARY KEY);
             CREATE TABLE stock_movements (id INTEGER PRIMARY KEY);
             CREATE TABLE settings (id INTEGER PRIMARY KEY);
             CREATE TABLE refresh_tokens (id INTEGER PRIMARY KEY);",
            )
            .unwrap();
        if with_user {
            connection
                .execute("INSERT INTO users (id, name) VALUES (1, 'Preserve me')", [])
                .unwrap();
        }
    }

    fn count(connection: &rusqlite::Connection, table: &str) -> i64 {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    #[test]
    fn cp850_preserves_french_accents_and_initializes_printer() {
        let bytes = cp850_receipt("CafÃƒÂ© rÃƒÂ©glÃƒÂ©");
        assert_eq!(&bytes[..5], &[0x1b, 0x40, 0x1b, 0x74, 0x02]);
        assert!(bytes.contains(&0x82));
    }

    #[test]
    fn validates_escpos_raster_payload_shape() {
        let mut valid = vec![0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 0x02, 0x00, 0x03, 0x00];
        valid.extend_from_slice(&[0; 6]);
        assert!(valid_escpos_raster(&valid));

        let mut truncated = valid.clone();
        truncated.pop();
        assert!(!valid_escpos_raster(&truncated));

        let mut wrong_command = valid.clone();
        wrong_command[3] = 0x00;
        assert!(!valid_escpos_raster(&wrong_command));

        let mut oversized_height = valid.clone();
        oversized_height[8] = 0x81;
        oversized_height[9] = 0x3e;
        assert!(!valid_escpos_raster(&oversized_height));
    }

    #[test]
    fn rejects_unsafe_printer_names_and_copy_counts() {
        assert!(print_receipt("bad\nname".into(), "ticket".into(), 1).is_err());
        assert!(print_receipt("printer".into(), "ticket".into(), 3).is_err());
    }

    #[test]
    fn embedded_seed_is_healthy_and_clean() {
        let root = test_root("seed");
        assert!(ensure_seed_database(&root).unwrap());
        let connection = rusqlite::Connection::open(root.join("data/bimik-cafe.sqlite")).unwrap();
        let quick_check: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(quick_check, "ok");
        assert_eq!(count(&connection, "users"), 2);
        assert_eq!(count(&connection, "categories"), 10);
        assert_eq!(count(&connection, "products"), 92);
        for table in [
            "sales",
            "sale_items",
            "cash_register_sessions",
            "stock_movements",
        ] {
            assert_eq!(count(&connection, table), 0, "{table} must be empty");
        }
        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn known_empty_legacy_database_is_backed_up_and_repaired() {
        let root = test_root("empty-legacy");
        let database = root.join("data/bimik-cafe.sqlite");
        create_known_empty_database(&database, false);
        assert!(ensure_seed_database(&root).unwrap());
        let connection = rusqlite::Connection::open(&database).unwrap();
        assert_eq!(count(&connection, "users"), 2);
        assert_eq!(count(&connection, "categories"), 10);
        assert_eq!(count(&connection, "products"), 92);
        drop(connection);
        let backup_count = std::fs::read_dir(root.join("data"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("legacy-empty"))
            .count();
        assert_eq!(backup_count, 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn non_empty_database_is_preserved_byte_for_byte() {
        let root = test_root("non-empty");
        let database = root.join("data/bimik-cafe.sqlite");
        create_known_empty_database(&database, true);
        let before = std::fs::read(&database).unwrap();
        assert!(!ensure_seed_database(&root).unwrap());
        assert_eq!(std::fs::read(&database).unwrap(), before);
        let connection = rusqlite::Connection::open(&database).unwrap();
        assert_eq!(count(&connection, "users"), 1);
        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn partial_empty_legacy_database_is_repaired() {
        let root = test_root("partial-empty");
        let database = root.join("data/bimik-cafe.sqlite");

        std::fs::create_dir_all(database.parent().unwrap()).unwrap();

        let connection = rusqlite::Connection::open(&database).unwrap();

        connection
            .execute_batch(
                "CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT
             );
             CREATE TABLE products (
                id INTEGER PRIMARY KEY
             );
             CREATE TABLE settings (
                id INTEGER PRIMARY KEY
             );",
            )
            .unwrap();

        drop(connection);

        assert!(ensure_seed_database(&root).unwrap());

        let connection = rusqlite::Connection::open(&database).unwrap();

        assert_eq!(count(&connection, "users"), 2);
        assert_eq!(count(&connection, "categories"), 10);
        assert_eq!(count(&connection, "products"), 92);

        drop(connection);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn partial_database_with_data_is_preserved() {
        let root = test_root("partial-data");
        let database = root.join("data/bimik-cafe.sqlite");

        std::fs::create_dir_all(database.parent().unwrap()).unwrap();

        let connection = rusqlite::Connection::open(&database).unwrap();

        connection
            .execute_batch(
                "CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT
             );
             CREATE TABLE products (
                id INTEGER PRIMARY KEY
             );
             INSERT INTO users (id, name)
             VALUES (1, 'Preserve me');",
            )
            .unwrap();

        drop(connection);

        assert!(!ensure_seed_database(&root).unwrap());

        let connection = rusqlite::Connection::open(&database).unwrap();

        assert_eq!(count(&connection, "users"), 1);

        drop(connection);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn approved_catalog_upgrade_is_additive_safe_and_idempotent() {
        let root = test_root("approved-catalog-upgrade");
        assert!(ensure_seed_database(&root).unwrap());
        let database = root.join("data/bimik-cafe.sqlite");
        let connection = rusqlite::Connection::open(&database).unwrap();

        connection
            .execute(
                "INSERT INTO sales(
                    id,user_id,cash_register_session_id,payment_method,note,
                    total_cents,profit_cents,created_at,updated_at
                 ) VALUES(9001,1,NULL,'cash','historique client',1200,400,
                          '2026-08-01T12:00:00Z','2026-08-01T12:00:00Z')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO sale_items(
                    id,sale_id,product_id,quantity,unit_price_cents,purchase_price_cents,
                    total_cents,profit_cents,created_at,updated_at
                 ) VALUES(9001,9001,1,1,1200,800,1200,400,
                          '2026-08-01T12:00:00Z','2026-08-01T12:00:00Z')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE products
                 SET name='Nom client conserve',sale_price_cents=777,stock=42,
                     image='/uploads/products/image-client.png'
                 WHERE id=1",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO products(
                    id,category_id,name,purchase_price_cents,sale_price_cents,stock,
                    min_stock,track_stock,image,is_active,created_at,updated_at
                 ) VALUES(1000,1,'Produit cree par le client',100,250,9,2,1,
                          '/uploads/products/client-1000.png',1,
                          '2026-08-02T00:00:00Z','2026-08-02T00:00:00Z')",
                [],
            )
            .unwrap();

        let preserved_product: (String, i64, i64, Option<String>) = connection
            .query_row(
                "SELECT name,sale_price_cents,stock,image FROM products WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        let customer_product: (String, i64, i64, Option<String>) = connection
            .query_row(
                "SELECT name,sale_price_cents,stock,image FROM products WHERE id=1000",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        let history_before: (i64, i64, i64) = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM sales),
                        (SELECT COUNT(*) FROM sale_items),
                        (SELECT COALESCE(SUM(total_cents),0) FROM sales)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        connection
            .execute("DELETE FROM products WHERE id=93", [])
            .unwrap();
        drop(connection);

        let first = migrate_missing_approved_catalog(&root, &database).unwrap();
        assert_eq!(first.categories_inserted, 0);
        assert_eq!(first.products_inserted, 1);

        let connection = rusqlite::Connection::open(&database).unwrap();
        assert_eq!(count(&connection, "products"), 93); // 92 approved + one customer row
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM products WHERE id=19", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT name,sale_price_cents,stock,image FROM products WHERE id=1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap(),
            preserved_product
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT name,sale_price_cents,stock,image FROM products WHERE id=1000",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap(),
            customer_product
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT (SELECT COUNT(*) FROM sales),
                            (SELECT COUNT(*) FROM sale_items),
                            (SELECT COALESCE(SUM(total_cents),0) FROM sales)",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap(),
            history_before
        );

        let removable_category: i64 = connection
            .query_row(
                "SELECT category_id FROM products
                 WHERE category_id IS NOT NULL AND category_id != (SELECT category_id FROM products WHERE id=1)
                 GROUP BY category_id ORDER BY category_id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let approved_in_category: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM products WHERE category_id=? AND id<=93",
                [removable_category],
                |row| row.get(0),
            )
            .unwrap();
        connection
            .execute(
                "DELETE FROM products WHERE category_id=?",
                [removable_category],
            )
            .unwrap();
        connection
            .execute("DELETE FROM categories WHERE id=?", [removable_category])
            .unwrap();
        drop(connection);

        let category_restore = migrate_missing_approved_catalog(&root, &database).unwrap();
        assert_eq!(category_restore.categories_inserted, 1);
        assert_eq!(
            category_restore.products_inserted as i64,
            approved_in_category
        );
        assert_eq!(
            migrate_missing_approved_catalog(&root, &database).unwrap(),
            CatalogMigrationResult::default()
        );

        let connection = rusqlite::Connection::open(&database).unwrap();
        assert_eq!(count(&connection, "categories"), 10);
        assert_eq!(count(&connection, "products"), 93);
        assert_eq!(
            connection
                .query_row("PRAGMA foreign_key_check", [], |_row| Ok(1i64))
                .optional()
                .unwrap(),
            None
        );
        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bundled_product_images_attach_to_empty_legacy_images() {
        let root = test_root("bundled-product-images-empty-legacy");

        assert!(ensure_seed_database(&root).unwrap());

        let database = root.join("data/bimik-cafe.sqlite");
        let connection = rusqlite::Connection::open(&database).unwrap();

        connection
            .execute("UPDATE products SET image=NULL WHERE id=1", [])
            .unwrap();

        connection
            .execute(
                "UPDATE products
                 SET image='/uploads/products/customer-custom-image.png'
                 WHERE id=2",
                [],
            )
            .unwrap();

        drop(connection);

        let first = provision_product_images(&root, &database).unwrap();

        // Exactly the legacy empty image becomes linked. The custom image stays custom.
        assert_eq!(first.1, 1);

        let bundled = product_images_generated::PRODUCT_IMAGES
            .iter()
            .find(|asset| asset.product_id == 1)
            .unwrap();

        let connection = rusqlite::Connection::open(&database).unwrap();

        let repaired: Option<String> = connection
            .query_row("SELECT image FROM products WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert_eq!(repaired.as_deref(), Some(bundled.image_url));

        let custom: Option<String> = connection
            .query_row("SELECT image FROM products WHERE id=2", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert_eq!(
            custom.as_deref(),
            Some("/uploads/products/customer-custom-image.png")
        );

        assert!(root
            .join("uploads")
            .join("products")
            .join(bundled.file_name)
            .is_file());

        drop(connection);

        // Second launch must be idempotent.
        let second = provision_product_images(&root, &database).unwrap();
        assert_eq!(second.0, 0);
        assert_eq!(second.1, 0);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bundled_product_images_are_idempotent_and_preserve_custom_images() {
        let root = test_root("bundled-product-images");

        assert!(ensure_seed_database(&root).unwrap());

        let database = root.join("data/bimik-cafe.sqlite");

        assert_eq!(product_images_generated::PRODUCT_IMAGES.len(), 92);

        let first = provision_product_images(&root, &database).unwrap();

        assert_eq!(first.0, 92);

        let connection = rusqlite::Connection::open(&database).unwrap();

        let linked: i64 = connection
            .query_row(
                "SELECT COUNT(*)
                 FROM products
                 WHERE image LIKE
                 '/uploads/products/bimik-bundled-%'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(linked, 92);

        drop(connection);

        let second = provision_product_images(&root, &database).unwrap();

        assert_eq!(second.0, 0);

        // A bundled-owned image whose installed bytes are stale
        // must be refreshed on the next startup.
        let bundled_asset = &product_images_generated::PRODUCT_IMAGES[0];
        let bundled_target = root
            .join("uploads")
            .join("products")
            .join(bundled_asset.file_name);

        std::fs::write(&bundled_target, b"stale-old-bundled-image").unwrap();

        let refreshed = provision_product_images(&root, &database).unwrap();

        assert_eq!(refreshed.0, 1);

        let refreshed_bytes = std::fs::read(&bundled_target).unwrap();

        assert_eq!(refreshed_bytes.as_slice(), bundled_asset.bytes);

        // Stable product IDs, not mutable display names, own bundled image
        // lineage. A renamed seeded product is safely relinked and refreshed.
        let renamed_asset = &product_images_generated::PRODUCT_IMAGES[1];
        let connection = rusqlite::Connection::open(&database).unwrap();
        connection
            .execute(
                "UPDATE products SET name='Nom approuvÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© renommÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©',image=? WHERE id=?",
                rusqlite::params![
                    format!(
                        "/uploads/products/bimik-bundled-{:03}_ancienne-image.png",
                        renamed_asset.product_id
                    ),
                    renamed_asset.product_id
                ],
            )
            .unwrap();
        drop(connection);
        let renamed = provision_product_images(&root, &database).unwrap();
        assert_eq!(renamed.1, 1);
        let connection = rusqlite::Connection::open(&database).unwrap();
        let renamed_url: String = connection
            .query_row(
                "SELECT image FROM products WHERE id=?",
                [renamed_asset.product_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(renamed_url, renamed_asset.image_url);
        drop(connection);

        let connection = rusqlite::Connection::open(&database).unwrap();

        connection
            .execute(
                "UPDATE products
             SET image='/uploads/products/custom-user-image.png'
             WHERE id=1",
                [],
            )
            .unwrap();

        drop(connection);

        let third = provision_product_images(&root, &database).unwrap();

        assert!(third.2 >= 1);

        let connection = rusqlite::Connection::open(&database).unwrap();

        let image: String = connection
            .query_row(
                "SELECT image
                 FROM products
                 WHERE id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(image, "/uploads/products/custom-user-image.png");

        // Missing mapped IDs and unrelated replacement rows are ignored.
        connection
            .execute(
                "DELETE FROM products WHERE id=?",
                [renamed_asset.product_id],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE products SET name='Produit client sans lien',image=NULL WHERE id=3",
                [],
            )
            .unwrap();
        drop(connection);
        let safe = provision_product_images(&root, &database).unwrap();
        assert!(safe.2 >= 1);
        let connection = rusqlite::Connection::open(&database).unwrap();
        let unrelated_image: Option<String> = connection
            .query_row("SELECT image FROM products WHERE id=3", [], |row| {
                row.get(0)
            })
            .unwrap();
        let expected_unrelated_image = product_images_generated::PRODUCT_IMAGES
            .iter()
            .find(|asset| asset.product_id == 3)
            .unwrap()
            .image_url;

        assert_eq!(unrelated_image.as_deref(), Some(expected_unrelated_image));

        drop(connection);

        std::fs::remove_dir_all(root).unwrap();
    }

    fn printer(name: &str, driver: &str) -> PrinterInfo {
        PrinterInfo {
            name: name.into(),
            driver_name: driver.into(),
            port: "USB001".into(),
            is_default: false,
        }
    }

    #[test]
    fn resolver_selects_pos80_and_excludes_virtual_printers() {
        let printers = vec![
            printer("Microsoft Print to PDF", "Microsoft Print To PDF"),
            printer("AnyDesk Printer", "virtual"),
            printer("POS-80", "POS-80 Printer Driver"),
        ];
        assert_eq!(resolve_printer(&printers, None).unwrap().name, "POS-80");
    }

    #[test]
    fn resolver_prefers_valid_configured_printer_and_rejects_ambiguity() {
        let printers = vec![
            printer("POS-80 Kitchen", "POS80"),
            printer("POS-80 Counter", "POS80"),
        ];
        assert_eq!(
            resolve_printer(&printers, Some("POS-80 Counter"))
                .unwrap()
                .name,
            "POS-80 Counter"
        );
        assert!(resolve_printer(&printers, None)
            .unwrap_err()
            .contains("Plusieurs"));
        assert!(resolve_printer(&[printer("Microsoft XPS Document Writer", "XPS")], None).is_err());
    }
}
