export const REPO = "holedev/zola-cleaner";
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const ISSUES_URL = `${REPO_URL}/issues`;
/** Hỏi lúc trang mở để lấy link file cài mới nhất (tên file có số phiên bản). */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
/** Đuôi tên file cài NSIS mà workflow Release tải lên. */
export const INSTALLER_SUFFIX = "_x64-setup.exe";
