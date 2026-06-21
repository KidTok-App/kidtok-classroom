-- 1. Create profiles table (User/Parent records)
CREATE TABLE IF NOT EXISTS public.profiles (
  id text PRIMARY KEY,
  display_name text,
  email text,
  picture text,
  last_selected_child text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policies (Allows owners and shared demo accounts)
CREATE POLICY select_profiles ON public.profiles FOR SELECT
  USING (id = auth.uid()::text OR id LIKE 'demo%');

CREATE POLICY insert_profiles ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid()::text OR id LIKE 'demo%');

CREATE POLICY update_profiles ON public.profiles FOR UPDATE
  USING (id = auth.uid()::text OR id LIKE 'demo%')
  WITH CHECK (id = auth.uid()::text OR id LIKE 'demo%');


-- 2. Create child_profiles table
CREATE TABLE IF NOT EXISTS public.child_profiles (
  owner_id text REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text,
  age_band integer NOT NULL,
  interests text,
  art_style text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (owner_id, name)
);

ALTER TABLE public.child_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY child_profiles_all ON public.child_profiles FOR ALL
  USING (owner_id = auth.uid()::text OR owner_id LIKE 'demo%')
  WITH CHECK (owner_id = auth.uid()::text OR owner_id LIKE 'demo%');


-- 3. Create child_insights table (Parent-steerage)
CREATE TABLE IF NOT EXISTS public.child_insights (
  owner_id text REFERENCES public.profiles(id) ON DELETE CASCADE,
  child_name text,
  insights_text text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (owner_id, child_name)
);

ALTER TABLE public.child_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY child_insights_all ON public.child_insights FOR ALL
  USING (owner_id = auth.uid()::text OR owner_id LIKE 'demo%')
  WITH CHECK (owner_id = auth.uid()::text OR owner_id LIKE 'demo%');


-- 4. Create episodes table (Full episode payloads)
CREATE TABLE IF NOT EXISTS public.episodes (
  id text PRIMARY KEY,
  owner_id text REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic text NOT NULL,
  age_band integer NOT NULL,
  status text NOT NULL,
  generation_mode text,
  video_url text,
  title text,
  scenes jsonb,
  review jsonb,
  error text,
  user_steerage text,
  metrics jsonb,
  child_profile jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY episodes_all ON public.episodes FOR ALL
  USING (owner_id = auth.uid()::text OR owner_id LIKE 'demo%')
  WITH CHECK (owner_id = auth.uid()::text OR owner_id LIKE 'demo%');


-- 5. Create episodes_index table (Index lists)
CREATE TABLE IF NOT EXISTS public.episodes_index (
  episode_id text PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  owner_id text REFERENCES public.profiles(id) ON DELETE CASCADE,
  child_name text,
  topic text NOT NULL,
  age_band integer NOT NULL,
  status text NOT NULL,
  prompt_version_used text,
  review_score integer,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.episodes_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY episodes_index_all ON public.episodes_index FOR ALL
  USING (owner_id = auth.uid()::text OR owner_id LIKE 'demo%')
  WITH CHECK (owner_id = auth.uid()::text OR owner_id LIKE 'demo%');


-- 6. Create PostgreSQL trigger to automatically keep index table in sync
CREATE OR REPLACE FUNCTION public.sync_episodes_index()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.episodes_index (
    episode_id,
    owner_id,
    child_name,
    topic,
    age_band,
    status,
    prompt_version_used,
    review_score,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.owner_id,
    NEW.child_profile->>'name',
    NEW.topic,
    NEW.age_band,
    NEW.status,
    COALESCE(NEW.review->>'promptVersionUsed', NEW.metrics->>'scenePromptVersion'),
    (NEW.review->>'score')::integer,
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (episode_id) DO UPDATE SET
    owner_id = EXCLUDED.owner_id,
    child_name = EXCLUDED.child_name,
    topic = EXCLUDED.topic,
    age_band = EXCLUDED.age_band,
    status = EXCLUDED.status,
    prompt_version_used = EXCLUDED.prompt_version_used,
    review_score = EXCLUDED.review_score,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trg_sync_episodes_index
  AFTER INSERT OR UPDATE ON public.episodes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_episodes_index();
