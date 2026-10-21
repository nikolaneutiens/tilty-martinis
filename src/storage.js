export const loadNumber = (key, fallback) => {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
};

export const saveNumber = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
};
