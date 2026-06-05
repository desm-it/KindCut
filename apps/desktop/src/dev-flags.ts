// Developer/debug flag. End users never see technical output (file paths, raw
// slicebug stdout/stderr/transcript, console logs). Enable it at runtime from the
// devtools console with:  localStorage.setItem("kindcut-debug", "1")  then reload.
export const DEBUG: boolean = (() => {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("kindcut-debug") === "1";
  } catch {
    return false;
  }
})();
