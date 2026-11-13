// The fixed list of interests a shopper can choose (interests.js keeps the choices; validate.js checks the ids).
// The interests, each with the receipt categories (receipt-category.js CATEGORIES) a shop must have to count as a match.
// Several interests share a category, because Relay doesn't sort shops more finely than that.
export const INTERESTS = {
  fashion: { label: "Fashion", categories: ["fashion"] },
  activewear: { label: "Activewear", categories: ["fashion"] },
  trainers: { label: "Trainers", categories: ["fashion"] },
  beauty: { label: "Beauty", categories: ["beauty"] },
  home: { label: "Home", categories: ["home"] },
  garden: { label: "Garden", categories: ["home"] },
  tech: { label: "Tech", categories: ["electronics"] },
  gaming: { label: "Games and apps", categories: ["digital", "electronics"] },
  food: { label: "Food and drink", categories: ["food"] },
  coffee: { label: "Coffee and tea", categories: ["food"] },
  travel: { label: "Travel", categories: ["travel"] },
  daysout: { label: "Days out", categories: ["experiences"] }
};
export const INTEREST_IDS = Object.keys(INTERESTS);
export const MAX_INTERESTS = 12;
