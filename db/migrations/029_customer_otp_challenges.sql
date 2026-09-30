CREATE TABLE IF NOT EXISTS customer_otp_challenges (
  phone text PRIMARY KEY CHECK (phone ~ '^7[0-9]{10}$'),
  code_digest text NOT NULL CHECK (length(code_digest) = 64),
  state text NOT NULL CHECK (state IN ('pending', 'active')),
  expires_at timestamptz NOT NULL,
  resend_available_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS customer_otp_challenges_expires_idx
  ON customer_otp_challenges (expires_at);

COMMENT ON TABLE customer_otp_challenges IS
  'First-party SMS login challenges. OTP values are retained only as keyed SHA-256 digests.';
