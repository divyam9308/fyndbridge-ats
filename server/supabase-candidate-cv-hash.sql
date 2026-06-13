alter table public.candidates
  add column if not exists cv_file_hash text,
  add column if not exists cv_storage_path text;

create index if not exists candidates_cv_file_hash_idx
  on public.candidates(cv_file_hash)
  where cv_file_hash is not null;
