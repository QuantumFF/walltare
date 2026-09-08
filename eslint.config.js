import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // The last two are makepkg's, from packaging/PKGBUILD: its build
    // directory and the package tree it assembles under fakeroot.
    ignores: ["dist/", "src-tauri/target/", "packaging/src/", "packaging/pkg/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
