// Barrel for the platform module. See docs/implementation/platform-layering-build-spec.md §1.6.
export * from "./types";
export { desktopPlatform } from "./desktopPlatform";
export { webPlatform } from "./webPlatform";
export { memoryPlatform, type MemoryPlatformOverrides } from "./memoryPlatform";
export { getPlatform, getPlatformOptional, setPlatform } from "./platformSingleton";
export {
  PlatformProvider,
  usePlatform,
  usePlatformOptional,
  detectPlatform
} from "./PlatformContext";
