import { endSession, getSession, login, LoginError, onSessionChange } from "./auth";
import { t } from "./i18n";
import type { LoginView } from "./views/loginView";

// Shows the login screen whenever nobody is logged in (at start-up, and when
// the API stops accepting the token), and wires the user's email and the
// logout button in the top bar.
export class AuthController {
  private loginView: LoginView;
  private userEmail: HTMLElement;
  /** Email of the last logged-in user, pre-filled when they have to log in again. */
  private lastEmail = "";

  constructor(loginView: LoginView) {
    this.loginView = loginView;
    this.userEmail = document.getElementById("user-email")!;

    this.loginView.onSubmit((email, password) => this.login(email, password));
    document.getElementById("logout-btn")!.addEventListener("click", () => this.logout());
    onSessionChange((session) => {
      if (session) {
        this.lastEmail = session.email;
        this.userEmail.textContent = session.email;
        this.loginView.hide();
      } else {
        this.userEmail.textContent = "";
        this.loginView.show(this.lastEmail);
      }
    });

    const session = getSession();
    if (session) {
      this.lastEmail = session.email;
      this.userEmail.textContent = session.email;
    } else {
      this.loginView.show();
    }
  }

  private async login(email: string, password: string): Promise<void> {
    if (!email || !password) {
      this.loginView.showError(t("auth.missingCredentials"));
      return;
    }
    this.loginView.setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      const invalid = err instanceof LoginError && err.reason === "invalid";
      this.loginView.setBusy(false);
      this.loginView.showError(t(invalid ? "auth.invalidCredentials" : "auth.unreachable"));
    }
  }

  // Reloading drops the open project, so nothing of it stays visible for
  // whoever logs in next.
  private logout(): void {
    if (!window.confirm(t("auth.confirmLogout"))) return;
    this.lastEmail = "";
    endSession();
    location.reload();
  }
}
