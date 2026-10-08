// Заглушка next/cache для скриптов вне Next: revalidatePath ничего не делает, но считает вызовы.
const calls = [];
module.exports = { revalidatePath: (p) => { calls.push(p); }, revalidateTag: () => {}, unstable_cache: (f) => f, __calls: calls };
