// Where the menu server (the API) lives. This one line switches the whole site over to the database.
//   ""                                  keep using menu.json and WhatsApp only (the site as it worked before the backend)
//   "https://your-service.onrender.com" use the database: live menu, saved orders, order status, admin and staff pages
// For testing without changing this file, open a page with ?api=<address> (for example menu.html?api=http://localhost:3000).
window.MENU_API = "";
