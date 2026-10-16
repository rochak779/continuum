ALTER TABLE continuum.profiles
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS company_size text,
  ADD COLUMN IF NOT EXISTS primary_currency text,
  ADD COLUMN IF NOT EXISTS time_zone text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS designation text;

CREATE TABLE IF NOT EXISTS continuum.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'Member',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON continuum.team_invites TO authenticated;
GRANT ALL ON continuum.team_invites TO service_role;

ALTER TABLE continuum.team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own invites" ON continuum.team_invites
  FOR SELECT TO authenticated USING (auth.uid() = inviter_id);
CREATE POLICY "Users can create their own invites" ON continuum.team_invites
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = inviter_id);
CREATE POLICY "Users can update their own invites" ON continuum.team_invites
  FOR UPDATE TO authenticated USING (auth.uid() = inviter_id) WITH CHECK (auth.uid() = inviter_id);
CREATE POLICY "Users can delete their own invites" ON continuum.team_invites
  FOR DELETE TO authenticated USING (auth.uid() = inviter_id);

CREATE TRIGGER update_team_invites_updated_at
  BEFORE UPDATE ON continuum.team_invites
  FOR EACH ROW EXECUTE FUNCTION continuum.update_updated_at_column();
