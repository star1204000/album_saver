-- ============================================================
-- 夏日记忆 · Summer Memory Album —— Supabase 建表脚本
-- ------------------------------------------------------------
-- 使用方法：
--   1. 登录 https://supabase.com → 进入你的项目
--   2. 左侧 SQL Editor → New query → 整段粘贴本脚本 → Run
--   3. 再到 Storage → New bucket 创建名为 photos 的公开桶（见 README 第 2 步）
--   4. Settings → API 记录 Project URL 与 anon public key，
--      填入项目根目录 .env.local（参考 .env.example）
-- ============================================================

-- 创建照片元数据表（图片本体存 Supabase Storage，这里只存元数据与对象路径）
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  image_url text not null,          -- Storage 公开访问 URL
  storage_path text not null,       -- Storage 对象路径 {uuid}.jpg (便于后续删除)
  date varchar(32) not null default '',  -- 提取自 EXIF 或用户指定 (YYYY.MM.DD)
  location text default '',         -- 拍摄地点
  coords jsonb,                     -- GPS 坐标: {"lat": 39.9, "lng": 116.4}
  caption text default '',          -- 回忆文案
  tags text[] default '{}',         -- 快捷预设标签数组
  custom_tags text[] default '{}',  -- 自定义专属标签数组
  sort_order int default 0          -- 排序权重（拖拽排序后批量更新）
);

-- 开启 Row Level Security (RLS)
alter table public.photos enable row level security;

-- 匿名 key 全开放策略（个人相册场景；公网部署前请按需收紧，见 README 安全说明）
drop policy if exists "Allow all operations with anon key" on public.photos;
create policy "Allow all operations with anon key" on public.photos
  for all using (true) with check (true);

-- 开启 Realtime 监听（多端实时协同的核心开关）
-- 幂等处理：表已在发布中则跳过（避免重复执行报 42710 错误）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'photos'
  ) then
    alter publication supabase_realtime add table public.photos;
  end if;
end
$$;

-- ★ 关键：DELETE 事件必须将副本标识设为 FULL，
--   否则 Realtime 推送的 DELETE 载荷中拿不到被删行的 id，客户端无法移除对应照片
alter table public.photos replica identity full;

-- 排序查询索引（列表按 sort_order → created_at 输出）
create index if not exists photos_sort_idx on public.photos (sort_order, created_at);

-- ============================================================
-- Storage 桶（照片原图存储，免费 1GB）
-- 也可在控制台 Storage → New bucket 手动创建，二选一即可：
-- ============================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

-- 桶的公开读写策略（anon key 可上传/删除照片对象）
drop policy if exists "photos public read" on storage.objects;
create policy "photos public read" on storage.objects
  for select using (bucket_id = 'photos');

drop policy if exists "photos public insert" on storage.objects;
create policy "photos public insert" on storage.objects
  for insert with check (bucket_id = 'photos');

drop policy if exists "photos public delete" on storage.objects;
create policy "photos public delete" on storage.objects
  for delete using (bucket_id = 'photos');
