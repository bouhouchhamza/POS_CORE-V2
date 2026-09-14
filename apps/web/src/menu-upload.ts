export type MenuSelection = { file: File | null; error: string | null };
export function selectMenuPdf(candidate: File | null): MenuSelection {
  if (!candidate) return { file: null, error: null };
  if (candidate.type !== "application/pdf" || !candidate.name.toLowerCase().endsWith(".pdf")) return { file: null, error: "Sélectionnez un fichier PDF valide." };
  return { file: candidate, error: null };
}
export function createMenuPdfFormData(file: File) { const formData = new FormData(); formData.append("pdf", file, file.name); return formData; }
export function tryBeginUpload(lock: { current: boolean }) { if (lock.current) return false; lock.current = true; return true; }
