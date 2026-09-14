fn main() {
    println!("cargo:rerun-if-env-changed=LICENSE_SERVER_URL");
    println!("cargo:rerun-if-env-changed=LICENSE_SIGNING_PUBLIC_KEY");

    // A release installer must never be produced without the verification
    // key. The key is public (not the signing secret) and is embedded by
    // option_env! in lib.rs. Debug/test builds stay convenient for developers.
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let key = std::env::var("LICENSE_SIGNING_PUBLIC_KEY")
            .expect("Release build blocked: LICENSE_SIGNING_PUBLIC_KEY is required.");
        let trimmed = key.trim();
        if trimmed.contains("PRIVATE KEY")
            || !trimmed.contains("-----BEGIN PUBLIC KEY-----")
            || !trimmed.contains("-----END PUBLIC KEY-----")
        {
            panic!("Release build blocked: LICENSE_SIGNING_PUBLIC_KEY is not a valid public-key PEM.");
        }
    }

    tauri_build::build()
}
