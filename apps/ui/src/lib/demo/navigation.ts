// Fail closed immediately when a mode-changing navigation starts. In particular,
// an outstanding wallet promise must not trigger another signature/transaction
// from the old document while its replacement is loading.
let modeSwitchPending = false;
export const beginModeSwitch = () => {
  modeSwitchPending = true;
};
export const assertNoModeSwitch = () => {
  if (modeSwitchPending)
    throw new Error(
      "Application mode is changing. Wait for the page to reload before using a wallet.",
    );
};
