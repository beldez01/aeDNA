import { useEffect, useState } from "react";

/**
 * Hook to persist page state in localStorage.
 * State is automatically saved and restored when the user navigates.
 * 
 * @param key - Unique key for this page (e.g., "differentials", "charge-field")
 * @param initialState - Default state object
 * @returns [state, setState] - Current state and setter function
 */
export function usePageState<T>(key: string, initialState: T): [T, (newState: T | ((prev: T) => T)) => void] {
  const storageKey = `aedna_page_${key}`;
  
  // Initialize from localStorage or use initial state
  const [state, setStateInternal] = useState<T>(() => {
    if (typeof window === "undefined") return initialState;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.warn(`Failed to load state for ${key}:`, err);
    }
    return initialState;
  });

  // Save to localStorage whenever state changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (err) {
      console.warn(`Failed to save state for ${key}:`, err);
    }
  }, [state, storageKey, key]);

  // Wrapper to support both direct values and updater functions
  const setState = (newState: T | ((prev: T) => T)) => {
    if (typeof newState === "function") {
      setStateInternal((prev) => (newState as (prev: T) => T)(prev));
    } else {
      setStateInternal(newState);
    }
  };

  return [state, setState];
}

