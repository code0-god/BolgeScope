use crate::notes;
use crate::project_path::project_path;
use crate::recovery;
use crate::storage::{commit_temporary, digest, new_id, save_file, save_trace, MAX_FILE_BYTES};
use crate::trace_export;
use std::fs;

#[test]
fn source_save_rejects_bytes_that_cannot_be_read_back() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let path = root.join("oversize.mb");
    assert_eq!(
        save_file(&path, &vec![b' '; MAX_FILE_BYTES + 1], None)
            .unwrap_err()
            .code,
        "FILE_TOO_LARGE"
    );
    assert!(!path.exists());
    let bytes = vec![b' '; MAX_FILE_BYTES];
    save_file(&path, &bytes, None).unwrap();
    assert_eq!(
        crate::storage::read_file(&path, "test".into(), "max.mb".into())
            .unwrap()
            .bytes,
        bytes
    );
    let id = recovery::write(&root, "max-source", 1, None, &bytes).unwrap();
    assert!(recovery::list(&root)
        .unwrap()
        .iter()
        .any(|record| record.recovery_id == id));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn atomic_save_rejects_stale_revision() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let path = root.join("source.mb");
    let first = save_file(&path, b"first", None).unwrap();
    assert_eq!(
        save_file(&path, b"second", Some("stale")).unwrap_err().code,
        "CONFLICT"
    );
    assert_eq!(fs::read(&path).unwrap(), b"first");
    assert_eq!(
        save_file(&path, b"second", Some(&first.disk_revision))
            .unwrap()
            .disk_revision,
        digest(b"second")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn staged_save_rechecks_existing_target_before_commit() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let path = root.join("source.mb");
    let temporary = root.join("staged.tmp");
    fs::write(&path, b"original").unwrap();
    fs::write(&temporary, b"ours").unwrap();
    fs::write(&path, b"external edit").unwrap();
    assert_eq!(
        commit_temporary(
            &path,
            &temporary,
            Some(&digest(b"original")),
            MAX_FILE_BYTES
        )
        .unwrap_err()
        .code,
        "CONFLICT"
    );
    assert_eq!(fs::read(&path).unwrap(), b"external edit");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn staged_create_does_not_replace_a_new_target() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let path = root.join("source.mb");
    let temporary = root.join("staged.tmp");
    fs::write(&temporary, b"ours").unwrap();
    fs::write(&path, b"external create").unwrap();
    assert_eq!(
        commit_temporary(&path, &temporary, None, MAX_FILE_BYTES)
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    assert_eq!(fs::read(&path).unwrap(), b"external create");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn project_path_blocks_escape_and_symlink() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    assert_eq!(
        project_path(&root, "../outside", false).unwrap_err().code,
        "INVALID_PATH"
    );
    assert_eq!(
        project_path(&root, "/tmp/outside", false).unwrap_err().code,
        "INVALID_PATH"
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(std::env::temp_dir(), root.join("link")).unwrap();
        assert_eq!(
            project_path(&root, "link/outside", false).unwrap_err().code,
            "INVALID_PATH"
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovery_keeps_source_separate_and_rejects_older_revisions() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let bytes = vec![b'a'; 2 * 1024 * 1024];
    let id = recovery::write(&root, "doc-1", 2, None, &bytes).unwrap();
    assert_eq!(recovery::list(&root).unwrap()[0].bytes, bytes);
    assert_eq!(
        recovery::write(&root, "doc-1", 1, None, b"old")
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    recovery::remove(&root, &id).unwrap();
    assert!(recovery::list(&root).unwrap().is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovery_list_skips_corrupt_entry_without_deleting_it() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let good_id = recovery::write(&root, "good", 1, None, b"recoverable").unwrap();
    let bad_id = digest(b"bad");
    let bad_path = root.join("recovery").join(format!("{bad_id}.recovery"));
    fs::write(&bad_path, b"not json\nmissing source").unwrap();
    let records = recovery::list(&root).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].recovery_id, good_id);
    assert_eq!(records[0].bytes, b"recoverable");
    assert!(bad_path.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovery_list_rejects_oversized_valid_prefix() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let good_id = recovery::write(&root, "good", 1, None, b"recoverable").unwrap();
    let bad_id = digest(b"oversized");
    let bad_path = root.join("recovery").join(format!("{bad_id}.recovery"));
    let mut header =
        br#"{"documentId":"oversized","sourceRevision":1,"observedDiskRevision":null}"#.to_vec();
    header.resize(4096, b' ');
    header.push(b'\n');
    header.extend(std::iter::repeat_n(b'x', MAX_FILE_BYTES + 1));
    fs::write(&bad_path, header).unwrap();
    let records = recovery::list(&root).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].recovery_id, good_id);
    assert!(bad_path.exists());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn recovery_list_does_not_follow_symlink_entry() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let good_id = recovery::write(&root, "good", 1, None, b"recoverable").unwrap();
    let outside = root.join("outside.recovery");
    fs::write(&outside, b"outside").unwrap();
    let link = root
        .join("recovery")
        .join(format!("{}.recovery", digest(b"link")));
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    let records = recovery::list(&root).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].recovery_id, good_id);
    assert_eq!(fs::read(&outside).unwrap(), b"outside");
    assert!(fs::symlink_metadata(&link)
        .unwrap()
        .file_type()
        .is_symlink());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn save_refuses_symlink_target() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let outside = root.join("outside.mb");
    fs::write(&outside, b"original").unwrap();
    let link = root.join("source.mb");
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    assert_eq!(
        save_file(&link, b"changed", Some(&digest(b"original")))
            .unwrap_err()
            .code,
        "INVALID_PATH"
    );
    assert_eq!(fs::read(&outside).unwrap(), b"original");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn trace_receipt_follows_atomic_write_and_conflict_check() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let path = root.join("run.btrace.jsonl");
    let bytes = vec![b'\n'; 3 * 1024 * 1024];
    let receipt = trace_export::write(&path, &bytes).unwrap();
    assert_eq!(receipt.file_digest, digest(&bytes));
    assert_eq!(receipt.byte_length, bytes.len());
    assert_eq!(receipt.name, "run.btrace.jsonl");
    assert_eq!(fs::read(&path).unwrap(), bytes);
    fs::write(&path, b"external edit").unwrap();
    assert_eq!(
        save_trace(&path, b"replacement", Some(&receipt.file_digest))
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    assert_eq!(fs::read(&path).unwrap(), b"external edit");
    assert!(!trace_export::valid_name("../run.btrace.jsonl"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn standalone_notes_stay_external_and_require_explicit_rebind() {
    let root = std::env::temp_dir().join(format!("bolgescope-test-{}", new_id()));
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let source = root.join("source.mb");
    fs::write(&source, b"source").unwrap();
    let first_digest = digest(b"source");
    let notes_bytes = br#"{"schemaVersion":1,"annotations":[]}"#;
    let saved = notes::write(&root, &source, &first_digest, notes_bytes, None, false).unwrap();
    let same = notes::read(&root, &source, &first_digest).unwrap().unwrap();
    assert!(!same.stale);
    assert_eq!(same.bytes, notes_bytes);
    assert_eq!(fs::read(&source).unwrap(), b"source");
    let later_digest = digest(b"edited source");
    assert!(
        notes::read(&root, &source, &later_digest)
            .unwrap()
            .unwrap()
            .stale
    );
    assert_eq!(
        notes::write(
            &root,
            &source,
            &later_digest,
            notes_bytes,
            Some(&saved.notes_revision),
            false
        )
        .err()
        .unwrap()
        .code,
        "STALE_BINDING"
    );
    let rebound = notes::write(
        &root,
        &source,
        &later_digest,
        notes_bytes,
        Some(&saved.notes_revision),
        true,
    )
    .unwrap();
    assert_eq!(
        notes::remove(&root, &source, &saved.notes_revision)
            .unwrap_err()
            .code,
        "CONFLICT"
    );
    notes::remove(&root, &source, &rebound.notes_revision).unwrap();
    assert!(notes::read(&root, &source, &later_digest)
        .unwrap()
        .is_none());
    fs::remove_dir_all(root).unwrap();
}
