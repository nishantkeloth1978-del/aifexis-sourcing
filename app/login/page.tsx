import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in | Aifexis Sourcing" };

export default function LoginPage() {
  return (
    <div className="loginwrap">
      <div className="logincard">
        <div className="loginbrand"><b>AIFEXIS</b><span>Sourcing</span></div>
        <h1>Sign in</h1>
        <LoginForm />
      </div>
    </div>
  );
}
