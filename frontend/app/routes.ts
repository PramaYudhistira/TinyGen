import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("recent", "routes/recent.tsx"),
  route("settings", "routes/settings.tsx"),
  route("chat/:chatId", "routes/chat.$chatId.tsx")
] satisfies RouteConfig;
