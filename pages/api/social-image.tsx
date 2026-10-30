import { bookMetadata, getPublishedPage, siteUrl } from '../../utils/blog-data';
import { isNotionNotFound } from '../../utils/blog-data';
import type { NextApiRequest, NextApiResponse } from 'next';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as React from 'react';
import '../../styles/globals.css';

import { ImageResponse } from '@vercel/og';

export const config = { maxDuration: 30 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).end();
  try {
    const id = typeof req.query.id === 'string' ? req.query.id : null;
    const meta = id ? bookMetadata(await getPublishedPage(id)) : null;
    const [fontBlack, fontRegular] = await Promise.all([
      readFile(join(process.cwd(), 'public/fonts/Pretendard-Black.woff')).then(data => new Uint8Array(data).buffer),
      readFile(join(process.cwd(), 'public/fonts/Pretendard-Regular.woff')).then(data => new Uint8Array(data).buffer),
    ]);
    const title = meta?.title || '프리머그의 Blog';
    const description = meta?.description || '';
    const tags = (meta?.tags || []).map(tag => tag.name);
    const icon = meta?.icon;
    const iconUrl = icon?.file?.url || icon?.external?.url;
    const absoluteIcon = iconUrl ? new URL(iconUrl, siteUrl()).href : undefined;
    const author = "프리머그의 Blog";
    const authorImage = "https://whal.eu/i/EWerYvZ7";
    const imageResponse = new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            padding: '46px',
            background: 'linear-gradient(-45deg, #1a1b1e 30%,rgb(61, 71, 130))',
            backdropFilter: 'blur(30px)',
            color: 'white',
            width: '100%',
            height: '100%',
            justifyContent: 'space-between'
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              flex: 1,
              height: '100%',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <b><h1 style={{ fontSize: '56px', fontWeight: 'bold', paddingTop: '24px', fontFamily: '"Black"' }}>{title}</h1></b>
              {description && <p style={{ fontSize: '24px', opacity: 0.8, fontFamily: '"Regular"' }}>{description}</p>}
              <div style={{ display: 'flex', fontSize: '22px', opacity: 0.6, fontFamily: '"Regular"' }}>
                {tags.map((tag: string, i) => (
                  <div
                    key={tag}
                    style={{ display: 'flex', marginRight: tags.length === i + 1 ? '' : '10px' }}
                  >
                    #{tag}
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <img
                src={authorImage}
                style={{
                  width: '100px',
                  height: '100px',
                  objectFit: 'cover',
                  objectPosition: 'center',
                  borderRadius: '50%',
                  marginRight: '16px',
                }}
              />

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column', fontFamily: '"Regular"'
                }}
              >
                <div style={{ fontSize: '32px', opacity: 0.8 }}>{author}</div>
                <div style={{ fontSize: '20px', opacity: 0.8 }}>책으로 쌓은 지식을 기록하고 연결합니다.</div>
              </div>
            </div>
          </div>



          {icon && icon.type === 'file' && (
            <img
              src={absoluteIcon}
              style={{
                width: '200px',
                height: '200px',
                position: 'absolute',
                bottom: '60px',
                right: '70px',
              }}
            />
          )}

          {icon && icon.type === 'external' && (
            <img
              src={absoluteIcon}
              style={{
                width: '200px',
                height: '200px',
                position: 'absolute',
                bottom: '60px',
                right: '70px',
              }}
            />
          )}
        </div>
      ),
      {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
        width: 1200,
        height: 630,
        fonts: [
          {
            name: 'Black',
            data: fontBlack,
            style: 'normal',
          },
          {
            name: 'Regular',
            data: fontRegular,
            style: 'normal',
          },
        ],
      },
    );
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(Buffer.from(await imageResponse.arrayBuffer()));
  } catch (error: any) {
    return res.status(isNotionNotFound(error) ? 404 : 502).end('Image unavailable');
  }
}
