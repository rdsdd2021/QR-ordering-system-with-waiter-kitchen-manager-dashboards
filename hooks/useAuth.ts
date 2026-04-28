// Re-export from AuthContext so all existing imports continue to work.
// Auth state is now a singleton shared via React Context — this eliminates
// the flickering caused by each component running its own independent
// getSession() + onAuthStateChange() calls.
export { useAuth } from "@/contexts/AuthContext";
