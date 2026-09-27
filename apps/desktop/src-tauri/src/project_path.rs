use crate::storage::{error, io_error, NativeResult};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub fn project_path(root: &Path, relative: &str, create_parents: bool) -> NativeResult<PathBuf> {
    if relative.is_empty() || relative.contains('\\') || relative.contains(':') {
        return Err(error("INVALID_PATH", "Expected a portable relative path"));
    }
    let components: Vec<_> = Path::new(relative).components().collect();
    if components.is_empty()
        || components
            .iter()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(error(
            "INVALID_PATH",
            "Project path must contain only normal components",
        ));
    }
    if fs::canonicalize(root).map_err(io_error)? != root {
        return Err(error("INVALID_PATH", "Project directory changed"));
    }
    let mut path = root.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        path.push(component.as_os_str());
        let is_final = index + 1 == components.len();
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(error(
                    "INVALID_PATH",
                    "Project path contains a symbolic link",
                ));
            }
            Ok(metadata) if !is_final && !metadata.is_dir() => {
                return Err(error(
                    "INVALID_PATH",
                    "Project path parent is not a directory",
                ));
            }
            Ok(_) => {}
            Err(cause)
                if cause.kind() == std::io::ErrorKind::NotFound && create_parents && !is_final =>
            {
                fs::create_dir(&path).map_err(io_error)?;
            }
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
            Err(cause) => return Err(io_error(cause)),
        }
    }
    let parent = path
        .parent()
        .ok_or_else(|| error("INVALID_PATH", "Missing parent"))?;
    if fs::canonicalize(parent).map_err(io_error)? != parent {
        return Err(error(
            "INVALID_PATH",
            "Project path escaped its selected directory",
        ));
    }
    Ok(path)
}
