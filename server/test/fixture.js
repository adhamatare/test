// A small, fully known menu. Expected prices used by the tests:
//   burger 10 | pizza 20 with 50% off = 10 | latte 4 | mocha 6
//   soup (sold out) | secret (hidden)
//   combo1 = burger + latte for 12 (regular 14, saves 2) | combo2 includes the sold-out soup, so it is unavailable
const day = { closed: false, open: "09:00", close: "17:00" };

export const fixture = () => ({
  settings: {
    currency: "$", deliveryFee: 3, whatsapp: "972500000000", timezone: "UTC",
    useHours: false, pauseOrders: false, minDeliveryOrder: 20, freeDeliveryOver: 50,
    deliveryAreas: [{ en: "North", ar: "", fee: 5 }, { en: "South", ar: "", fee: 2 }],
    hours: { mon: { ...day }, tue: { ...day }, wed: { ...day }, thu: { ...day }, fri: { ...day }, sat: { ...day }, sun: { ...day } },
  },
  venues: [
    { key: "Restaurant", ar: "", sections: [{ en: "Mains", ar: "", items: [
      { id: "burger", en: "Burger", ar: "", dEn: "", dAr: "", price: 10, discount: 0, pic: "", isNew: false, soldOut: false, hidden: false },
      { id: "pizza", en: "Pizza", ar: "", dEn: "", dAr: "", price: 20, discount: 50, pic: "", isNew: false, soldOut: false, hidden: false },
      { id: "soup", en: "Soup", ar: "", dEn: "", dAr: "", price: 5, discount: 0, pic: "", isNew: false, soldOut: true, hidden: false },
      { id: "secret", en: "Secret dish", ar: "", dEn: "", dAr: "", price: 7, discount: 0, pic: "", isNew: false, soldOut: false, hidden: true },
    ] }] },
    { key: "Cafe", ar: "", sections: [{ en: "Drinks", ar: "", items: [
      { id: "latte", en: "Latte", ar: "", dEn: "", dAr: "", price: 4, discount: 0, pic: "", isNew: false, soldOut: false, hidden: false },
      { id: "mocha", en: "Mocha", ar: "", dEn: "", dAr: "", price: 6, discount: 0, pic: "", isNew: false, soldOut: false, hidden: false },
    ] }] },
  ],
  bundles: [
    { id: "combo1", en: "Burger and Latte", ar: "", dEn: "", dAr: "", price: 12, pic: "", isNew: false, hidden: false, items: [{ id: "burger", qty: 1 }, { id: "latte", qty: 1 }] },
    { id: "combo2", en: "Soup combo", ar: "", dEn: "", dAr: "", price: 8, pic: "", isNew: false, hidden: false, items: [{ id: "soup", qty: 1 }, { id: "latte", qty: 1 }] },
  ],
});
