// KidTok Classroom — Supabase Client configuration
// Migrated from legacy Firebase on 2026-06-21.
import { createClient } from "@supabase/supabase-js";

// Force manual project parameters to prevent Lovable build overrides from hijacking traffic
const supabaseUrl = "https://qlmmahcfuhhgszoqenyu.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsbW1haGNmdWhoZ3N6b3Flbnl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDQwMzgsImV4cCI6MjA5NzM4MDAzOH0.k94V-Yfiv_Vf5Ms136J4tHcsXJDeIeBYAe75TLjlvp0";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

