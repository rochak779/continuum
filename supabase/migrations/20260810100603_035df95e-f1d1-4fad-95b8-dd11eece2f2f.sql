CREATE TABLE continuum.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  organization_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON continuum.profiles TO authenticated;
GRANT ALL ON continuum.profiles TO service_role;

ALTER TABLE continuum.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON continuum.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON continuum.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON continuum.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION continuum.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = continuum, extensions, pg_temp;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON continuum.profiles
  FOR EACH ROW EXECUTE FUNCTION continuum.update_updated_at_column();

REVOKE EXECUTE ON FUNCTION continuum.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- No trigger on auth.users: it is shared with other apps in this Supabase
-- project and would fire for their sign-ups too. The app creates this row
-- on first sign-in instead (src/lib/continuum-profile.ts).
