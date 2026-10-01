// The full-screen login form (#login-screen). Covers the app until the user
// is logged in; reports submitted credentials through `onSubmit`.
export class LoginView {
  private root: HTMLElement;
  private form: HTMLFormElement;
  private email: HTMLInputElement;
  private password: HTMLInputElement;
  private error: HTMLElement;
  private submitButton: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.form = root.querySelector("form")!;
    this.email = root.querySelector<HTMLInputElement>("#login-email")!;
    this.password = root.querySelector<HTMLInputElement>("#login-password")!;
    this.error = root.querySelector<HTMLElement>("#login-error")!;
    this.submitButton = root.querySelector<HTMLButtonElement>("button[type=submit]")!;
    this.email.addEventListener("input", () => this.showError(""));
    this.password.addEventListener("input", () => this.showError(""));
  }

  /** Called with the entered email and password when the form is submitted. */
  onSubmit(handler: (email: string, password: string) => void): void {
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      handler(this.email.value.trim(), this.password.value);
    });
  }

  /** Shows the form, optionally pre-filling the email (e.g. after the session expired). */
  show(email = ""): void {
    this.email.value = email;
    this.password.value = "";
    this.showError("");
    this.setBusy(false);
    this.root.classList.add("visible");
    (email ? this.password : this.email).focus();
  }

  hide(): void {
    this.root.classList.remove("visible");
    this.password.value = "";
  }

  showError(message: string): void {
    this.error.textContent = message;
  }

  /** Disables the form while a login request is running. */
  setBusy(busy: boolean): void {
    this.submitButton.disabled = busy;
    this.email.disabled = busy;
    this.password.disabled = busy;
  }
}
