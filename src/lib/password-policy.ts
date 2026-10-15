// Политика пароля: не короче 10 символов, не только цифры, не совпадает с почтой и не из списка самых частых.
const COMMON = new Set(["password", "password1", "qwerty123", "1234567890", "qwertyuiop", "12345678910", "admin12345", "letmein123", "iloveyou12", "йцукен1234", "пароль1234"]);

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 10) return "Пароль не короче 10 символов";
  if (password.length > 200) return "Пароль слишком длинный";
  if (/^\d+$/.test(password)) return "Пароль не должен состоять только из цифр";
  if (email && password.toLowerCase() === email.trim().toLowerCase()) return "Пароль не должен совпадать с почтой";
  if (COMMON.has(password.toLowerCase())) return "Слишком простой пароль";
  return null;
}
