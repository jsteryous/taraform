import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://ykuenmwfxecmmqichwit.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrdWVubXdmeGVjbW1xaWNod2l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MTAxMzAsImV4cCI6MjA4MzQ4NjEzMH0.MoJO92cIHwVXKGj7A9NXtCZW-JaKKAPrxxoch_Ga1Qk'
);