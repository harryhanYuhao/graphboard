export function toSafeFilename(name: string): string {
  return name
    .trim()
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}
