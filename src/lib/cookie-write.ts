/**
 * Запись cookie режима (год, 4%, НДС, тема) ровно одной записью с path=/.
 * Перед записью гасим возможные двойники с тем же именем на вложенных путях и с domain (остатки старых версий),
 * иначе браузер отдаёт серверу обе записи с разными значениями.
 */
export function writeCookie(name: string, value: string) {
  try {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const paths = new Set<string>([window.location.pathname]);
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      paths.add(acc);
      paths.add(acc + "/");
    }
    paths.delete("/");
    for (const path of paths) {
      document.cookie = `${name}=; path=${path}; max-age=0; samesite=lax`;
      document.cookie = `${name}=; path=${path}; domain=${window.location.hostname}; max-age=0; samesite=lax`;
    }
    document.cookie = `${name}=; path=/; domain=${window.location.hostname}; max-age=0; samesite=lax`;
  } catch {
    /* куки закрыты — ниже запись всё равно попробуем */
  }
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}
