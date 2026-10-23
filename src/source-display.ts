// Preserve the archived evidence and its dates; omit only the tool's fixed notice.
export function referenceDisplayHtml(value: string): string {
  return value.replace(/ℹ️ 조회기준일 \d{8} — 위 시행일 버전 본문\. 연혁 MST로 조회한 경우 과거 버전일 수 있으니, 개정 여부가 의심되면 search_law로 \[현행\] MST를 재확인할 것\.(?:<br\s*\/?>|\r?\n)?/g, "");
}
