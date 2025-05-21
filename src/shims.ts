// This file provides shims for missing modules
// Import this at the top of your main.ts file

// Create a mock for class-transformer/storage if it's missing
if (typeof window !== "undefined") {
  // Only run this in browser environment
  try {
    // Check if the module exists
    require("class-transformer/storage")
  } catch (e) {
    // If it doesn't exist, create a mock
    const mockStorage = {
      defaultMetadataStorage: {
        getTargetPropertiesMetadata: () => [],
      },
    }

    // Add it to the module cache
    if (require.cache) {
      require.cache[require.resolve("class-transformer/storage")] = {
        id: require.resolve("class-transformer/storage"),
        filename: require.resolve("class-transformer/storage"),
        loaded: true,
        exports: mockStorage,
      } as any
    }
  }
}
