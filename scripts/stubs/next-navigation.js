module.exports = { redirect: (u) => { throw new Error("REDIRECT:" + u); }, notFound: () => { throw new Error("NOT_FOUND"); } };
