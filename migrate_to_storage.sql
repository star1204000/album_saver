-- ★ 表结构迁移（旧表 → Storage 版）：
-- 旧表用的是 r2_key 列；新代码用 storage_path。执行本脚本补列即可，原有数据不受影响。

-- 1. 补 storage_path 列（若不存在）
alter table public.photos
  add column if not exists storage_path text not null default '';

-- 2. 把旧 r2_key 的值迁到 storage_path（如果有旧数据）
update public.photos
  set storage_path = coalesce(r2_key, '')
  where r2_key is not null and storage_path = '';

-- 3. 移除旧列（确认数据已迁移后执行；想保守可先注释这行）
alter table public.photos
  drop column if exists r2_key;
