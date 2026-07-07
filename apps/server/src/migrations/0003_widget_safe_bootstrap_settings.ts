import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const up: Migration['up'] = async (db) => {
  await sql`
    alter table widgets
      add column assistant_display_name text not null default 'Support',
      add column launcher_label text not null default 'Chat',
      add column launcher_icon text not null default 'message',
      add column welcome_title text not null default 'Hi there',
      add column welcome_subtitle text not null default 'Send us a message and we will reply as soon as we can.',
      add column theme_color_mode text not null default 'system',
      add column theme_accent text not null default 'blue',
      add column theme_radius text not null default 'md'
  `.execute(db);

  await sql`
    alter table widgets
      add constraint widgets_launcher_icon_check check (launcher_icon in ('message')),
      add constraint widgets_theme_color_mode_check check (theme_color_mode in ('light', 'dark', 'system')),
      add constraint widgets_theme_accent_check check (theme_accent in ('blue')),
      add constraint widgets_theme_radius_check check (theme_radius in ('md'))
  `.execute(db);
};

export const down: Migration['down'] = async (db) => {
  await sql`
    alter table widgets
      drop constraint if exists widgets_theme_radius_check,
      drop constraint if exists widgets_theme_accent_check,
      drop constraint if exists widgets_theme_color_mode_check,
      drop constraint if exists widgets_launcher_icon_check
  `.execute(db);

  await sql`
    alter table widgets
      drop column if exists theme_radius,
      drop column if exists theme_accent,
      drop column if exists theme_color_mode,
      drop column if exists welcome_subtitle,
      drop column if exists welcome_title,
      drop column if exists launcher_icon,
      drop column if exists launcher_label,
      drop column if exists assistant_display_name
  `.execute(db);
};
