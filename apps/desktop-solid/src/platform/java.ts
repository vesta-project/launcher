import { invoke, isTauri } from "@tauri-apps/api/core";
export interface VerifiedJava {
  path: string;
  major_version: number;
  is_64bit: boolean;
}
export async function verifyJavaExecutable(
  path: string,
): Promise<VerifiedJava> {
  if (!isTauri()) throw new Error("Open the desktop app to test Java.");
  return invoke<VerifiedJava>("verify_java_path", { pathStr: path });
}
export const canBrowseJava = isTauri;
export const browseJavaExecutable = () =>
  invoke<string | null>("select_java_file");
