import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://awytguwbkbstbeinttbj.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3eXRndXdia2JzdGJlaW50dGJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4Nzk4NTUsImV4cCI6MjA3MDQ1NTg1NX0.SXjpwTQWck1b4GN1aSIUk7e14Q2Nq_zslgWixqzzlbM';

// Database types
export interface Chat {
  id: string;
  user_id: string;
  title: string;
  github_repo_url: string | null;
  snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  is_tool_use: boolean;
  metadata: Record<string, any>;
  created_at: string;
}

export interface AgentContext {
  id: string;
  chat_id: string;
  user_id: string;
  thread_id: string;
  checkpoint_id: string | null;
  state_data: Record<string, any>;
  config: Record<string, any>;
  tool_results: any[];
  memory_data: Record<string, any>;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// Simple Supabase client - we'll use user_id directly for RLS
export const supabase = createClient(supabaseUrl, supabaseAnonKey);