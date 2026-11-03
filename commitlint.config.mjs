// Conventional Commits — khớp preset "conventionalcommits" mà semantic-release dùng để tính phiên bản (.releaserc.json).
export default {
  extends: ["@commitlint/config-conventional"],
  // Dependabot tự sinh tiêu đề "chore(deps): bump …" (xem .github/dependabot.yml), nhưng với group hoặc package tên dài
  // tiêu đề có thể vượt 100 ký tự. Không sửa được message của bot, nên bỏ qua lint cho commit của nó.
  ignores: [(message) => message.includes("Signed-off-by: dependabot[bot]")],
};
