import Head from 'next/head'
import * as React from 'react'

import { getSocialImageUrl } from '../utils/get-social-image-url'

export const PageHead: React.FC<any> = ({ title, description, pageId, image, url }) => {
  const socialImageUrl = getSocialImageUrl(pageId) || image

  return (
    <Head>
      <meta charSet='utf-8' />
      <meta httpEquiv='Content-Type' content='text/html; charset=utf-8' />
      <meta
        name='viewport'
        content='width=device-width, initial-scale=1, shrink-to-fit=no'
      />

      <meta name='robots' content='index,follow' />
      <meta property='og:type' content='website' />

      <meta property='og:site_name' content="프리머그의 Blog" />
      <meta property='twitter:domain' content="https://blog.yuntae.in" />

      <meta name='description' content={"책으로 쌓은 지식을 기록하고 연결합니다."} />
      <meta property='og:description' content={"책으로 쌓은 지식을 기록하고 연결합니다."} />
      <meta name='twitter:description' content={"책으로 쌓은 지식을 기록하고 연결합니다."} />

      {socialImageUrl ? (
        <>
          <meta name='twitter:card' content='summary_large_image' />
          <meta name='twitter:image' content={socialImageUrl} />
          <meta property='og:image' content={socialImageUrl} />
        </>
      ) : (
        <meta name='twitter:card' content='summary' />
      )}

      {url && (
        <>
          <link rel='canonical' href={url} />
          <meta property='og:url' content={url} />
          <meta property='twitter:url' content={url} />
        </>
      )}

      <meta property='og:title' content={title} />
      <meta name='twitter:title' content={title} />
      <title>{title}</title>
    </Head>
  )
}
