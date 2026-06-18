
-- 1. child_profiles
CREATE TABLE public.child_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  age_band int NOT NULL,
  interests text NOT NULL DEFAULT '',
  art_style text NOT NULL DEFAULT 'crayon sketch',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.child_profiles TO authenticated;
GRANT ALL ON public.child_profiles TO service_role;
ALTER TABLE public.child_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parents manage their own child profiles"
  ON public.child_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. child_insights
CREATE TABLE public.child_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_name text,
  insights_text text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Partial unique index (Postgres treats NULLs as distinct in normal UNIQUE)
CREATE UNIQUE INDEX child_insights_user_child_uniq
  ON public.child_insights (user_id, child_name)
  WHERE child_name IS NOT NULL;
CREATE UNIQUE INDEX child_insights_user_default_uniq
  ON public.child_insights (user_id)
  WHERE child_name IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.child_insights TO authenticated;
GRANT ALL ON public.child_insights TO service_role;
ALTER TABLE public.child_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parents manage their own insights"
  ON public.child_insights FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. user_preferences
CREATE TABLE public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_selected_child text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT ALL ON public.user_preferences TO service_role;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parents manage their own preferences"
  ON public.user_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. episodes_index
CREATE TABLE public.episodes_index (
  episode_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_name text,
  topic text NOT NULL,
  age_band int NOT NULL,
  status text NOT NULL,
  prompt_version_used text,
  review_score int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX episodes_index_user_created_idx
  ON public.episodes_index (user_id, created_at DESC);
CREATE INDEX episodes_index_user_child_idx
  ON public.episodes_index (user_id, child_name);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.episodes_index TO authenticated;
GRANT ALL ON public.episodes_index TO service_role;
ALTER TABLE public.episodes_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parents read their own episode index rows"
  ON public.episodes_index FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Parents insert their own episode index rows"
  ON public.episodes_index FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Parents update their own episode index rows"
  ON public.episodes_index FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_child_profiles_updated_at
  BEFORE UPDATE ON public.child_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_child_insights_updated_at
  BEFORE UPDATE ON public.child_insights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_episodes_index_updated_at
  BEFORE UPDATE ON public.episodes_index
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
