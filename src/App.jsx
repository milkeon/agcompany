import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getApp, getApps, initializeApp } from 'firebase/app'
import { collection, doc, getDoc, getDocs, getFirestore, orderBy, query, setDoc } from 'firebase/firestore'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import './App.css'

gsap.registerPlugin(ScrollTrigger)

const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
}

const FIREBASE_COLLECTIONS = {
  pages: import.meta.env.VITE_FIREBASE_PORTFOLIO_COLLECTION || 'portfolio_pages',
  projects: import.meta.env.VITE_FIREBASE_PROJECTS_COLLECTION || 'portfolio_projects',
}

const FIREBASE_REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId']

const STORAGE_KEY = 'agcompany-editor-v1'
const GITHUB_STORAGE_KEY = 'agcompany-github-settings-v1'
const DB_STORAGE_KEY = 'agcompany-db-settings-v1'
const SETTINGS_COLLAPSED_KEY = 'agcompany-settings-collapsed-v1'

const getFirebaseConfigError = () => {
  const missing = FIREBASE_REQUIRED_KEYS.filter((key) => !FIREBASE_CONFIG[key])
  return missing.length ? `Firebase 환경변수가 부족합니다: ${missing.join(', ')}` : ''
}

const getFirebaseApp = () => {
  const configError = getFirebaseConfigError()
  if (configError) {
    throw new Error(configError)
  }

  if (!getApps().length) {
    return initializeApp(FIREBASE_CONFIG)
  }

  return getApp()
}

const getFirebaseDb = () => getFirestore(getFirebaseApp())

const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const clone = (value) => JSON.parse(JSON.stringify(value))
const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('이미지 파일을 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })

const normalizeText = (value, fallback = '') => {
  const text = String(value || '').trim()
  return text || fallback
}

const sanitizeMarkdownText = (value) =>
  String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const splitSentences = (value) =>
  sanitizeMarkdownText(value)
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)

const takeReadableText = (value, limit = 140) => {
  const text = sanitizeMarkdownText(value)
  if (!text) return ''
  const sentences = splitSentences(text)
  const next = sentences.length ? sentences.slice(0, 2).join(' ') : text
  return next.length > limit ? `${next.slice(0, limit - 1).trimEnd()}…` : next
}

const extractGithubSection = (readmeText, keywords = []) => {
  const lines = String(readmeText || '').replace(/\r\n/g, '\n').split('\n')
  const targets = keywords.map((item) => String(item || '').toLowerCase()).filter(Boolean)
  if (!targets.length) return ''

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^#{1,6}\s+(.+)$/)
    if (!headingMatch) continue

    const heading = headingMatch[1].trim().toLowerCase()
    if (!targets.some((target) => heading.includes(target))) continue

    const buffer = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (/^#{1,6}\s+/.test(line)) break
      if (!line.trim()) {
        if (buffer.length) break
        continue
      }
      if (/^```/.test(line)) continue
      buffer.push(line.trim())
    }

    return takeReadableText(buffer.join(' '), 180)
  }

  return ''
}

const collectGithubTech = (repo, readmeText = '') => {
  const keywords = [
    'React',
    'Next.js',
    'Vite',
    'Vue',
    'Svelte',
    'TypeScript',
    'JavaScript',
    'Node.js',
    'Express',
    'Firebase',
    'Firestore',
    'Supabase',
    'Tailwind CSS',
    'CSS Modules',
    'SCSS',
    'Sass',
    'GSAP',
    'Three.js',
    'Framer Motion',
    'Redux',
    'Zustand',
    'Prisma',
    'MySQL',
    'PostgreSQL',
    'MongoDB',
    'Python',
    'Django',
    'Flask',
    'FastAPI',
    'C#',
    '.NET',
    'ASP.NET',
    'Java',
    'Spring Boot',
    'Kotlin',
    'Swift',
    'React Native',
    'Electron',
    'Vercel',
    'Netlify',
  ]

  const lowered = sanitizeMarkdownText(readmeText).toLowerCase()
  const matches = keywords.filter((keyword) => lowered.includes(keyword.toLowerCase()))
  const topicMatches = Array.isArray(repo.topics) ? repo.topics.filter(Boolean).map((topic) => String(topic).trim()) : []
  const list = [...matches, ...topicMatches, repo.language].filter(Boolean)
  return list.length ? [...new Set(list)].slice(0, 4).join(', ') : '미지정'
}

const buildProjectFromRepo = (repo, readmeText = '') => {
  const overviewFromReadme = extractGithubSection(readmeText, ['overview', '개요', '소개', 'summary', 'about']) || takeReadableText(readmeText, 150)
  const purposeFromReadme = extractGithubSection(readmeText, ['purpose', '목적', 'goal', 'objective', 'why', 'project purpose'])

  return {
    id: createId(),
    title: normalizeText(repo.name, 'GitHub 프로젝트'),
    type: repo.private ? 'GitHub / 비공개' : 'GitHub / 공개',
    tech: collectGithubTech(repo, readmeText),
    language: normalizeText(repo.language, '미지정'),
    overview: normalizeText(overviewFromReadme || repo.description, 'GitHub 저장소에서 불러온 프로젝트입니다.'),
    purpose: normalizeText(purposeFromReadme || repo.purpose, '포트폴리오 프로젝트 정리'),
    image: '',
    repoUrl: normalizeText(repo.html_url, ''),
    repoFullName: normalizeText(repo.fullName, ''),
    source: 'github',
    visible: true,
    firebaseId: '',
  }
}

const buildProjectFromFirebaseDoc = (row) => {
  const firebaseId = row?.id == null ? '' : String(row.id)
  return {
    id: createId(),
    firebaseId,
    title: normalizeText(row?.title || row?.name, 'Firebase 프로젝트'),
    type: normalizeText(row?.type || row?.category, 'Firebase / 프로젝트'),
    tech: normalizeText(row?.tech || row?.technologies || row?.stack, '미지정'),
    language: normalizeText(row?.language || row?.lang, '미지정'),
    overview: normalizeText(row?.overview || row?.description || row?.desc, 'Firebase 저장소에서 불러온 프로젝트입니다.'),
    purpose: normalizeText(row?.purpose || row?.goal || row?.objective, '포트폴리오 프로젝트 정리'),
    image: normalizeText(row?.image || row?.image_url || row?.imageUrl, ''),
    repoUrl: normalizeText(row?.repoUrl || row?.repo_url || row?.repoURL || row?.url, ''),
    repoFullName: normalizeText(row?.repoFullName || row?.fullName || row?.full_name, ''),
    source: normalizeText(row?.source || 'firebase', 'firebase'),
    visible: row?.visible === false ? false : true,
  }
}

const buildGithubHeaders = (token) => {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

const decodeGithubReadmeContent = (content) => {
  if (!content) return ''

  try {
    const binary = window.atob(String(content).replace(/\s+/g, ''))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

const fetchGithubReadmeText = async (fullName, token) => {
  if (!fullName) return ''

  const response = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
    headers: buildGithubHeaders(token),
  })

  if (!response.ok) {
    return ''
  }

  const payload = await response.json()
  if (typeof payload?.content === 'string') {
    return decodeGithubReadmeContent(payload.content)
  }

  if (typeof payload?.download_url === 'string') {
    const rawResponse = await fetch(payload.download_url, {
      headers: buildGithubHeaders(token),
    })
    if (rawResponse.ok) {
      return rawResponse.text()
    }
  }

  return ''
}

const shouldUpgradeProjectText = (currentValue, nextValue, defaultTexts = []) => {
  const current = normalizeText(currentValue, '')
  const next = normalizeText(nextValue, '')
  if (!next) return false
  if (!current) return true
  if (defaultTexts.some((text) => current.includes(text))) return true
  return next.length > current.length + 12
}

const shouldUpgradeProjectTech = (currentValue, nextValue) => {
  const current = normalizeText(currentValue, '')
  const next = normalizeText(nextValue, '')
  if (!next) return false
  if (!current || current === '미지정') return true
  const currentCount = current.split(',').map((item) => item.trim()).filter(Boolean).length
  const nextCount = next.split(',').map((item) => item.trim()).filter(Boolean).length
  return nextCount > currentCount
}

const SKILL_COLUMN_CLASSES = ['library-column', 'front-column', 'backend-column']
const SKILL_CARD_CLASSES = ['skill-card-large', 'skill-card-front', 'skill-card-backend']
const SKILL_TWEENS = [
  {
    selector: '.skill-bottom-word',
    from: { yPercent: 72, scale: 0.62, opacity: 0.25 },
    to: { yPercent: -6, scale: 1.12, opacity: 1 },
    start: 'top 92%',
    end: 'bottom 45%',
    scrub: 1,
  },
  {
    selector: '.library-column',
    from: { x: -120, y: 96, scale: 0.92, opacity: 0 },
    to: { x: 0, y: -12, scale: 1, opacity: 1 },
    start: 'top 82%',
    end: 'center 50%',
    scrub: 1,
  },
  {
    selector: '.front-column',
    from: { x: 140, y: 150, scale: 0.9, opacity: 0 },
    to: { x: 0, y: -18, scale: 1, opacity: 1 },
    start: 'top 78%',
    end: 'center 42%',
    scrub: 1,
  },
  {
    selector: '.backend-column',
    from: { x: 220, y: 72, scale: 0.92, opacity: 0 },
    to: { x: 0, y: -10, scale: 1, opacity: 1 },
    start: 'top 64%',
    end: 'bottom 54%',
    scrub: 1,
  },
  {
    selector: '.project-list',
    from: { x: 260 },
    to: { x: -180 },
    start: 'top 82%',
    end: 'bottom 20%',
    scrub: 1.1,
  },
]

const defaultData = {
  hero: {
    badge: 'THIS PAGE MADE BY REACT | GSAP | SCSS, TAKE A LOOK AROUND',
    kicker: '웹 개발 포트폴리오',
    titleLines: ['웹', '개발', '포트폴리오'],
    copy:
      '이름1의 작업을 담는 포트폴리오입니다. 검은 배경, 큰 타이포, 좌측 정렬, 아래로 길게 이어지는 흐름을 기준으로 원본의 리듬에 맞춰 정리했습니다.',
    meta: [
      { id: createId(), label: '역할', value: '프론트엔드 / 웹 개발' },
      { id: createId(), label: '방향', value: '부드럽고 자연스러운 인터랙션' },
      { id: createId(), label: '형태', value: '원페이지 포트폴리오' },
    ],
    actions: [
      { id: createId(), label: '프로젝트 보기', href: '#projects', variant: 'primary' },
      { id: createId(), label: '이력 보기', href: '#career', variant: 'secondary' },
    ],
    portraitLabel: '사진1',
    portraitImage: '',
    portraitCaptionTop: '웹 개발',
    portraitCaptionBottom: '포트폴리오',
  },
  interview: {
    tag: 'INTERVIEW',
    questions: [
      {
        id: createId(),
        title: 'Q. 프론트엔드를 지향하는 이유',
        answer:
          '사용자와의 상호작용을 직접 만들고 싶었고, 화면의 반응을 섬세하게 다듬는 작업에 매력을 느껴 프론트엔드 개발을 계속하고 있습니다.',
      },
      {
        id: createId(),
        title: 'Q. 일에 있어 가장 중요하게 생각하는 것이 있다면?',
        answer:
          '직관적인 UI, 명확한 구조, 그리고 사용자 중심의 흐름입니다. 정보가 눈에 걸리지 않고 자연스럽게 읽히도록 만드는 쪽을 더 선호합니다.',
      },
      {
        id: createId(),
        title: 'Q. 자기계발을 위해 어떤 것들을 해왔는지?',
        answer:
          '스터디, 사이드 프로젝트, 라이브러리 실험을 반복하면서 감각과 구현력을 같이 키우는 쪽으로 학습해왔습니다.',
      },
    ],
    portraitLabel: '김상준 이미지',
    portraitImage: '',
  },
  career: {
    tag: 'CAREER',
    title: '커리어',
    copy: '학습과 실무 경험을 분리해서 보이도록 정리한 이력 구간입니다.',
    items: [
      {
        id: createId(),
        title: '주식회사 메이즈',
        desc:
          '사용자 흐름과 유지 보수성을 함께 고려하며 웹 화면의 구조를 다듬는 작업을 진행했습니다.',
        bullets: ['React 기반 UI 작업', '상태와 화면 구조 정리', '반응형 및 스크롤 흐름 조정'],
      },
      {
        id: createId(),
        title: '라인컴퓨터아트학원',
        desc: 'React, PHP 기초, 알고리즘, GSAP, Swiper 등 다양한 라이브러리와 웹 표준, SEO를 함께 학습했습니다.',
        bullets: ['3개의 JavaScript 프로젝트', '2개의 React 프로젝트', '1개의 PHP 프로젝트'],
      },
    ],
  },
  skills: {
    tag: 'SKILL',
    railWord: 'PORTFOLIO',
    railIndex: '2024-2026',
    marquee: 'THIS PAGE MADE BY REACT | GSAP | SCSS, TAKE A LOOK AROUND',
    bottomWord: 'SKILL',
    groups: [
      {
        id: createId(),
        title: '라이브러리',
        items: [
          { id: createId(), name: 'Bootstrap', desc: '플레이스홀더 HTML을 빠르게 스타일링할 수 있게 사용했습니다.' },
          { id: createId(), name: 'Swiper', desc: '다양한 슬라이드 형태를 구현하는 데 사용했습니다.' },
          { id: createId(), name: 'Lenis', desc: '부드러운 스크롤 제어가 필요한 화면에 적용했습니다.' },
          { id: createId(), name: 'jQuery', desc: '간단한 DOM 제어와 기존 코드 유지 보수에 사용했습니다.' },
        ],
      },
      {
        id: createId(),
        title: '프론트',
        items: [
          { id: createId(), name: 'React', desc: '컴포넌트 구조와 Hooks를 활용해 화면을 개발했습니다.' },
          { id: createId(), name: 'Zustand', desc: '리액트 상태를 단순하고 빠르게 관리하기 위해 사용했습니다.' },
          { id: createId(), name: 'Svelte', desc: '간단한 상태 관리와 반응형 기능을 실험했습니다.' },
          { id: createId(), name: 'Next JS', desc: '정적 사이트 생성과 서버 사이드 렌더링 구조를 학습했습니다.' },
        ],
      },
      {
        id: createId(),
        title: '백엔드',
        items: [
          { id: createId(), name: 'PHP', desc: '게시글 작성 및 삭제 같은 기본 CRUD를 구현했습니다.' },
          { id: createId(), name: 'MySQL', desc: '정형 데이터를 저장하고 조회하는 흐름을 다뤘습니다.' },
        ],
      },
    ],
  },
  projects: {
    tag: 'PROJECTS',
    title: '프로젝트',
    items: [
      {
        id: createId(),
        title: '프로젝트1',
        type: '브랜딩 / 랜딩 페이지',
        tech: 'React, GSAP',
        language: 'JavaScript',
        overview: '큰 타이포와 강한 대비를 중심으로 시작하는 소개형 프로젝트입니다.',
        purpose: '브랜드 소개와 시각적 임팩트 전달',
        image: '',
        repoUrl: '',
        firebaseId: '',
      },
      {
        id: createId(),
        title: '프로젝트2',
        type: '콘텐츠 / 인터랙션',
        tech: 'React, ScrollTrigger',
        language: 'JavaScript',
        overview: '스크롤에 맞춰 화면이 아래로 흘러가며, 섹션 전환이 자연스럽게 이어집니다.',
        purpose: '섹션 전환과 인터랙션 경험 전달',
        image: '',
        repoUrl: '',
        firebaseId: '',
      },
      {
        id: createId(),
        title: '프로젝트3',
        type: '실험 / 개인 작업',
        tech: 'HTML, CSS',
        language: 'JavaScript',
        overview: '학습과 개인 작업을 플레이스홀더 기반으로 정리한 예시 카드입니다.',
        purpose: '실험 결과와 학습 정리',
        image: '',
        repoUrl: '',
        firebaseId: '',
      },
      {
        id: createId(),
        title: '프로젝트4',
        type: '리뉴얼 / 포트폴리오',
        tech: 'React, CSS Modules',
        language: 'TypeScript',
        overview: '좌우 배치와 긴 여백을 살려 원본의 프로젝트 리스트 감각을 흉내 낸 섹션입니다.',
        purpose: '포트폴리오 리뉴얼과 구조 정리',
        image: '',
        repoUrl: '',
        firebaseId: '',
      },
    ],
  },
  contact: {
    tag: 'CONTACT',
    title: '연락처 영역',
    copy: '이메일, 깃허브, 노션 같은 링크를 붙이면 바로 사용 가능합니다.',
    email: 'name1@example.com',
    buttons: [
      { id: createId(), label: 'name1@example.com', href: 'mailto:name1@example.com', variant: 'primary' },
      { id: createId(), label: '맨 위로', href: '#home', variant: 'secondary' },
    ],
  },
}

function normalizeData(raw) {
  const next = clone(defaultData)
  if (!raw || typeof raw !== 'object') return next

  const merge = (section) => ({ ...next[section], ...(raw[section] || {}) })
  next.hero = merge('hero')
  next.interview = merge('interview')
  next.career = merge('career')
  next.skills = merge('skills')
  next.projects = merge('projects')
  next.contact = merge('contact')

  next.hero.titleLines = Array.isArray(raw.hero?.titleLines) && raw.hero.titleLines.length ? raw.hero.titleLines.slice(0, 3) : next.hero.titleLines
  next.hero.meta = Array.isArray(raw.hero?.meta) && raw.hero.meta.length ? raw.hero.meta.map((item) => ({ id: item.id || createId(), label: item.label || '', value: item.value || '' })) : next.hero.meta
  next.hero.actions = Array.isArray(raw.hero?.actions) && raw.hero.actions.length ? raw.hero.actions.map((item) => ({ id: item.id || createId(), label: item.label || '', href: item.href || '#', variant: item.variant || 'primary' })) : next.hero.actions

  next.interview.questions = Array.isArray(raw.interview?.questions) && raw.interview.questions.length
    ? raw.interview.questions.map((item) => ({ id: item.id || createId(), title: item.title || '', answer: item.answer || '' }))
    : next.interview.questions

  next.career.items = Array.isArray(raw.career?.items) && raw.career.items.length
    ? raw.career.items.map((item) => ({
        id: item.id || createId(),
        title: item.title || '',
        desc: item.desc || '',
        bullets: Array.isArray(item.bullets) ? item.bullets : String(item.bulletsText || '').split('\n').map((line) => line.trim()).filter(Boolean),
      }))
    : next.career.items

  next.skills.groups = Array.isArray(raw.skills?.groups) && raw.skills.groups.length
    ? raw.skills.groups.map((group) => ({
        id: group.id || createId(),
        title: group.title || '',
        items: Array.isArray(group.items)
          ? group.items.map((item) => ({ id: item.id || createId(), name: item.name || '', desc: item.desc || '' }))
          : [],
      }))
    : next.skills.groups

  next.projects.items = Array.isArray(raw.projects?.items) && raw.projects.items.length
    ? raw.projects.items.map((item) => ({
        id: item.id || createId(),
        title: item.title || '',
        type: item.type || '',
        tech: item.tech || item.technologies || '',
        language: item.language || '',
        overview: item.overview || item.desc || '',
        purpose: item.purpose || '',
        image: item.image || '',
        repoUrl: item.repoUrl || '',
        repoFullName: item.repoFullName || item.fullName || '',
        firebaseId: item.firebaseId || '',
        source: item.source || (item.repoUrl ? 'github' : 'manual'),
        visible: item.visible === false ? false : true,
      }))
    : next.projects.items

  next.contact.buttons = Array.isArray(raw.contact?.buttons) && raw.contact.buttons.length
    ? raw.contact.buttons.map((item) => ({ id: item.id || createId(), label: item.label || '', href: item.href || '#', variant: item.variant || 'secondary' }))
    : next.contact.buttons

  return next
}

function loadStoredData() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    return normalizeData(raw)
  } catch {
    return clone(defaultData)
  }
}

function loadStoredGithubState() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(GITHUB_STORAGE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return { owner: '', token: '', repos: [], lastFetchedAt: '' }

    return {
      owner: raw.owner || '',
      token: raw.token || '',
      repos: Array.isArray(raw.repos) ? raw.repos : [],
      lastFetchedAt: raw.lastFetchedAt || '',
    }
  } catch {
    return { owner: '', token: '', repos: [], lastFetchedAt: '' }
  }
}

function loadStoredDbState() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') {
      return {
        pagesCollection: FIREBASE_COLLECTIONS.pages,
        pageDocId: 'agcompany-firebase-main',
        projectsCollection: FIREBASE_COLLECTIONS.projects,
        lastLoadedAt: '',
        lastSavedAt: '',
      }
    }

    return {
      pagesCollection: raw.pagesCollection || 'portfolio_pages',
      pageDocId: raw.pageDocId || 'agcompany-firebase-main',
      projectsCollection: raw.projectsCollection || 'portfolio_projects',
      lastLoadedAt: raw.lastLoadedAt || '',
      lastSavedAt: raw.lastSavedAt || '',
    }
  } catch {
    return {
      pagesCollection: FIREBASE_COLLECTIONS.pages,
      pageDocId: 'agcompany-firebase-main',
      projectsCollection: FIREBASE_COLLECTIONS.projects,
      lastLoadedAt: '',
      lastSavedAt: '',
    }
  }
}

function getModeFromHash() {
  return window.location.hash === '#setting' ? 'setting' : 'preview'
}

function splitLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function inlinePreviewText(value, placeholder, type) {
  const text = String(value || '').trim()
  if (type === 'password') return text ? '입력됨' : placeholder || '비어 있음'
  return text || placeholder || '비어 있음'
}

function EditableField({
  enabled = false,
  wrapperTag = 'div',
  displayTag = 'span',
  displayProps = {},
  value,
  onChange,
  onSave = null,
  placeholder = '',
  multiline = false,
  rows = 3,
  type = 'text',
  className = '',
  displayClassName = '',
  inputClassName = '',
  buttonClassName = '',
  editLabel = '수정',
  saveLabel = '저장',
}) {
  const [isEditing, setIsEditing] = useState(false)
  const text = inlinePreviewText(value, placeholder, type)
  const WrapperTag = wrapperTag
  const PreviewTag = displayTag

  const handleToggle = async () => {
    if (!enabled) return
    if (isEditing) {
      if (typeof onSave === 'function') {
        await onSave()
      } else if (typeof window !== 'undefined' && typeof window.__WHOMI_SAVE__ === 'function') {
        await window.__WHOMI_SAVE__()
      }
    }
    setIsEditing((prev) => !prev)
  }

  if (!enabled) {
    return <PreviewTag className={displayClassName} {...displayProps}>{text}</PreviewTag>
  }

  return (
    <WrapperTag className={`editable-field ${className}${isEditing ? ' is-editing' : ''}`}>
      {isEditing ? (
        multiline ? (
          <textarea
            autoFocus
            className={inputClassName}
            rows={rows}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            autoFocus
            className={inputClassName}
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      ) : (
        <PreviewTag className={displayClassName} {...displayProps}>{text}</PreviewTag>
      )}
      <button className={`tiny-button editable-field-button ${buttonClassName}`.trim()} type="button" onClick={handleToggle}>
        {isEditing ? saveLabel : editLabel}
      </button>
    </WrapperTag>
  )
}

function ImageUploadControl({ buttonLabel, className = '', onUpload }) {
  const handleChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    await onUpload(file)
  }

  return (
    <label className={`image-upload-control ${className}`.trim()}>
      <span className="button secondary tiny image-upload-trigger">{buttonLabel}</span>
      <input accept="image/*" className="image-upload-input" type="file" onChange={handleChange} />
    </label>
  )
}

function App() {
  const [mode, setMode] = useState(getModeFromHash)
  const [data, setData] = useState(loadStoredData)
  const [githubState, setGithubState] = useState(loadStoredGithubState)
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubError, setGithubError] = useState('')
  const [githubStatus, setGithubStatus] = useState('')
  const [dbState, setDbState] = useState(loadStoredDbState)
  const [dbError, setDbError] = useState('')
  const [dbStatus, setDbStatus] = useState('')
  const [firebaseProjects, setFirebaseProjects] = useState({ rows: [], lastFetchedAt: '' })
  const [firebaseProjectsLoading, setFirebaseProjectsLoading] = useState(false)
  const [firebaseProjectsError, setFirebaseProjectsError] = useState('')
  const [firebaseProjectsStatus, setFirebaseProjectsStatus] = useState('')
  const [firebaseHydrated, setFirebaseHydrated] = useState(false)
  const firebaseAutoSaveTimerRef = useRef(null)
  const githubReadmeCacheRef = useRef(new Map())
  const savedAt = dbState.lastSavedAt ? new Date(dbState.lastSavedAt).toLocaleString('ko-KR', { hour12: true }) : ''
  const isSettingMode = mode === 'setting'
  const [isSettingsCollapsed, setIsSettingsCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SETTINGS_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })

  const toggleSettingsCollapsed = useCallback(() => {
    setIsSettingsCollapsed((prev) => !prev)
  }, [])

  useEffect(() => {
    const syncHash = () => {
      const nextMode = getModeFromHash()
      setMode(nextMode)

      if (nextMode === 'preview') {
        const hash = window.location.hash.replace('#', '')
        if (hash) {
          requestAnimationFrame(() => {
            document.getElementById(hash)?.scrollIntoView({ block: 'start' })
          })
        }
      }
    }

    syncHash()
    window.addEventListener('hashchange', syncHash)
    return () => window.removeEventListener('hashchange', syncHash)
  }, [])

  useEffect(() => {
    if (mode !== 'setting') return undefined

    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.code === 'Space' && !event.altKey && !event.metaKey) {
        event.preventDefault()
        setIsSettingsCollapsed((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode])

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_COLLAPSED_KEY, isSettingsCollapsed ? '1' : '0')
    } catch {
      // no-op
    }
  }, [isSettingsCollapsed])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // no-op
    }
  }, [data])

  useEffect(() => {
    try {
      window.localStorage.setItem(GITHUB_STORAGE_KEY, JSON.stringify(githubState))
    } catch {
      // no-op
    }
  }, [githubState])

  useEffect(() => {
    try {
      window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(dbState))
    } catch {
      // no-op
    }
  }, [dbState])

  useEffect(() => {
    if (mode !== 'preview') return undefined

    const ctx = gsap.context(() => {
      gsap.from('.topbar, .hero-badge, .hero-kicker, .hero-title-line, .hero-copy, .hero-meta, .hero-actions, .hero-portrait', {
        opacity: 0,
        y: 24,
        duration: 1,
        ease: 'power3.out',
        stagger: 0.07,
      })

      gsap.to('.hero-orb', {
        y: 16,
        duration: 4,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      })

      gsap.utils.toArray('.section-heading, .about-panel, .career-card, .project-card, .contact-panel').forEach((item) => {
        const title = item.querySelector('.section-title, h2, h3')
        const tag = item.querySelector('.section-tag, .project-type')
        const copy = item.querySelector('.section-copy, p:not(.section-copy):not(.project-type)')

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: item,
            start: 'top 84%',
            end: 'bottom 50%',
            scrub: 0.9,
          },
        })

        tl.fromTo(item, { opacity: 0, y: 96, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, ease: 'none' })

        if (title) {
          tl.fromTo(title, { opacity: 0, y: 58, scale: 0.82 }, { opacity: 1, y: 0, scale: 1, ease: 'none' }, 0)
        }

        if (tag) {
          tl.fromTo(tag, { opacity: 0, y: 28, scale: 0.88 }, { opacity: 1, y: 0, scale: 1, ease: 'none' }, 0.08)
        }

        if (copy) {
          tl.fromTo(copy, { opacity: 0, y: 44, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, ease: 'none' }, 0.12)
        }

        if (item.classList.contains('project-card')) {
          tl.fromTo(item, { x: 300 }, { x: -120, ease: 'none' }, 0)
        }
      })

      gsap.utils.toArray('.reveal-up').forEach((item) => {
        gsap.fromTo(
          item,
          { opacity: 0, y: 72 },
          {
            opacity: 1,
            y: 0,
            duration: 1,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: item,
              start: 'top 86%',
            },
          },
        )
      })

      SKILL_TWEENS.forEach(({ selector, from, to, start, end, scrub }) => {
        gsap.fromTo(selector, from, {
          ...to,
          ease: 'none',
          scrollTrigger: {
            trigger: selector === '.project-list' ? '.section-projects' : '.skill-stage',
            start,
            end,
            scrub,
          },
        })
      })

      gsap.to('.skill-marquee span', {
        xPercent: -45,
        ease: 'none',
        scrollTrigger: {
          trigger: '.skill-stage',
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1.2,
        },
      })
    })

    return () => ctx.revert()
  }, [data, mode])

  const updateSection = (section, patch) => {
    setData((prev) => ({ ...prev, [section]: { ...prev[section], ...patch } }))
  }

  const updateArrayItem = (section, arrayName, id, patch) => {
    setData((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [arrayName]: prev[section][arrayName].map((item) => (item.id === id ? { ...item, ...patch } : item)),
      },
    }))
  }

  const updateNestedArrayItem = (section, arrayName, groupId, nestedName, itemId, patch) => {
    setData((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [arrayName]: prev[section][arrayName].map((group) =>
          group.id !== groupId
            ? group
            : {
                ...group,
                [nestedName]: group[nestedName].map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
              },
        ),
      },
    }))
  }

  const updateGithubSetting = (key, value) => {
    setGithubState((prev) => ({ ...prev, [key]: value }))
  }

  const updateDbSetting = (key, value) => {
    setDbState((prev) => ({ ...prev, [key]: value }))
  }

  const clearGithubResults = () => {
    setGithubError('')
    setGithubStatus('')
  }

  const clearDbResults = () => {
    setDbError('')
    setDbStatus('')
  }

  const clearFirebaseProjectResults = () => {
    setFirebaseProjectsError('')
    setFirebaseProjectsStatus('')
  }

  const enrichGithubProjectsFromReadme = useCallback(
    async (projects = data.projects.items, githubContext = githubState) => {
      const githubProjects = (projects || []).filter((project) => project?.source === 'github' && project?.repoFullName)
      if (!githubProjects.length) {
        return
      }

      const token = githubContext.token.trim()
      const repoMap = new Map((githubContext.repos || []).map((repo) => [String(repo.fullName || '').toLowerCase(), repo]))
      const updates = []

      for (const project of githubProjects) {
        const repoKey = String(project.repoFullName || '').trim().toLowerCase()
        if (!repoKey) continue

        let summary = githubReadmeCacheRef.current.get(repoKey)
        if (!summary) {
          const repoMeta = repoMap.get(repoKey) || {}
          const readmeText = await fetchGithubReadmeText(project.repoFullName, token)
          summary = {
            tech: collectGithubTech(repoMeta, readmeText),
            overview: extractGithubSection(readmeText, ['overview', '개요', '소개', 'summary', 'about']) || takeReadableText(readmeText, 150),
            purpose: extractGithubSection(readmeText, ['purpose', '목적', 'goal', 'objective', 'why', 'project purpose']),
          }
          githubReadmeCacheRef.current.set(repoKey, summary)
        }

        updates.push({ project, summary })
      }

      if (!updates.length) return

      setData((prev) => {
        let changed = false
        const items = prev.projects.items.map((item) => {
          const found = updates.find(({ project }) => project.id === item.id)
          if (!found) return item

          const nextItem = { ...item }
          const { summary } = found

          if (shouldUpgradeProjectTech(item.tech, summary.tech)) {
            nextItem.tech = summary.tech
            changed = true
          }

          if (shouldUpgradeProjectText(item.overview, summary.overview, ['GitHub 저장소에서 불러온 프로젝트입니다.'])) {
            nextItem.overview = normalizeText(summary.overview, item.overview)
            changed = true
          }

          if (shouldUpgradeProjectText(item.purpose, summary.purpose, ['포트폴리오 프로젝트 정리'])) {
            nextItem.purpose = normalizeText(summary.purpose, item.purpose)
            changed = true
          }

          return nextItem
        })

        if (!changed) return prev
        return { ...prev, projects: { ...prev.projects, items } }
      })
    },
    [data.projects.items, githubState],
  )

  const fetchGithubRepos = async () => {
    const owner = githubState.owner.trim()
    const token = githubState.token.trim()

    if (!owner && !token) {
      setGithubError('깃 아이디 또는 토큰을 먼저 입력해 주세요.')
      return
    }

    setGithubLoading(true)
    clearGithubResults()

    try {
      const headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }

      if (token) {
        headers.Authorization = `Bearer ${token}`
      }

      const normalized = []
      const seen = new Set()
      let page = 1

      while (true) {
        const endpoint = token
          ? `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&visibility=all&affiliation=owner,collaborator,organization_member`
          : `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&page=${page}&sort=updated&type=owner`

        const response = await fetch(endpoint, { headers })
        if (!response.ok) {
          throw new Error(`GitHub API 요청 실패 (${response.status})`)
        }

        const repos = await response.json()
        if (!Array.isArray(repos) || repos.length === 0) {
          break
        }

        repos.forEach((repo) => {
          if (!repo || !repo.name) {
            return
          }

          if (owner && token && repo.owner?.login && repo.owner.login.toLowerCase() !== owner.toLowerCase()) {
            return
          }

          const key = repo.full_name || `${repo.owner?.login || owner}/${repo.name}`
          if (seen.has(key)) {
            return
          }

          seen.add(key)
          normalized.push({
            id: repo.id,
            name: repo.name,
            fullName: key,
            description: repo.description || '',
            language: repo.language || '',
            topics: Array.isArray(repo.topics) ? repo.topics : [],
            html_url: repo.html_url,
            private: Boolean(repo.private),
          })
        })

        if (repos.length < 100) {
          break
        }

        page += 1
      }

      setGithubState((prev) => ({
        ...prev,
        repos: normalized,
        lastFetchedAt: new Date().toISOString(),
      }))
      setGithubStatus(`${normalized.length}개 저장소를 불러왔습니다.`)
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub 저장소를 불러오지 못했습니다.')
    } finally {
      setGithubLoading(false)
    }
  }

  const fetchDbPortfolio = async () => {
    const pagesCollection = dbState.pagesCollection.trim()
    const pageDocId = dbState.pageDocId.trim()

    if (!pagesCollection || !pageDocId) {
      setDbError('Firebase 컬렉션명과 문서 ID를 먼저 입력해 주세요.')
      return
    }

    clearDbResults()

    try {
      const db = getFirebaseDb()
      const snapshot = await getDoc(doc(db, pagesCollection, pageDocId))

      if (!snapshot.exists()) {
        throw new Error('저장된 포트폴리오 데이터가 없습니다.')
      }

      const nextSnapshotData = snapshot.data() || {}
      const nextData = nextSnapshotData.payload
      if (!nextData || typeof nextData !== 'object') {
        throw new Error('저장된 포트폴리오 데이터가 없습니다.')
      }

      const nextSettings = nextSnapshotData.settings && typeof nextSnapshotData.settings === 'object' ? nextSnapshotData.settings : {}
      const nextGithubState = nextSettings.githubState && typeof nextSettings.githubState === 'object' ? nextSettings.githubState : null

      setData(clone(nextData))
      setDbState((prev) => {
        if (nextGithubState) {
          setGithubState((current) => ({
            ...current,
            ...nextGithubState,
            owner: normalizeText(nextGithubState.owner || current.owner, ''),
            token: normalizeText(nextGithubState.token || current.token, ''),
            repos: Array.isArray(nextGithubState.repos) ? nextGithubState.repos : current.repos,
          }))
        }

        return {
          ...prev,
          pagesCollection: nextSettings.pagesCollection || prev.pagesCollection,
          pageDocId: nextSettings.pageDocId || prev.pageDocId,
          projectsCollection: nextSettings.projectsCollection || prev.projectsCollection,
          lastLoadedAt: new Date().toISOString(),
        }
      })
      setDbStatus('Firebase에서 포트폴리오를 불러왔습니다.')
      void enrichGithubProjectsFromReadme(nextData, nextGithubState || githubState)
    } catch (error) {
      setDbError(error instanceof Error ? error.message : 'Firebase에서 불러오지 못했습니다.')
    }
  }

  const saveDbPortfolio = useCallback(async (snapshotData = data) => {
    const pagesCollection = dbState.pagesCollection.trim()
    const pageDocId = dbState.pageDocId.trim()

    if (!pagesCollection || !pageDocId) {
      setDbError('Firebase 컬렉션명과 문서 ID를 먼저 입력해 주세요.')
      return
    }

    clearDbResults()

    try {
      const db = getFirebaseDb()
      await setDoc(
        doc(db, pagesCollection, pageDocId),
        {
          payload: clone(snapshotData),
          settings: {
            pagesCollection,
            pageDocId,
            projectsCollection: dbState.projectsCollection.trim(),
            githubState: clone(githubState),
          },
        },
        { merge: true },
      )

      setDbState((prev) => ({ ...prev, lastSavedAt: new Date().toISOString() }))
      setDbStatus('현재 포트폴리오를 Firebase에 저장했습니다.')
    } catch (error) {
      setDbError(error instanceof Error ? error.message : 'Firebase에 저장하지 못했습니다.')
    }
  }, [data, dbState, githubState])

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    let cancelled = false

    const hydrate = async () => {
      if (getFirebaseConfigError()) {
        setFirebaseHydrated(true)
        return
      }

      if (!dbState.pagesCollection.trim() || !dbState.pageDocId.trim()) {
        setFirebaseHydrated(true)
        return
      }

      try {
        await fetchDbPortfolio()
      } catch {
        // 초기 동기화 실패는 로컬 상태를 유지합니다.
      }

      if (!cancelled) {
        setFirebaseHydrated(true)
      }
    }

    hydrate()

    return () => {
      cancelled = true
    }
  }, [])
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!firebaseHydrated) {
      return undefined
    }

    if (getFirebaseConfigError()) {
      return undefined
    }

    if (!dbState.pagesCollection.trim() || !dbState.pageDocId.trim()) {
      return undefined
    }

    if (firebaseAutoSaveTimerRef.current) {
      window.clearTimeout(firebaseAutoSaveTimerRef.current)
    }

    firebaseAutoSaveTimerRef.current = window.setTimeout(() => {
      void saveDbPortfolio(data)
    }, 900)

    return () => {
      if (firebaseAutoSaveTimerRef.current) {
        window.clearTimeout(firebaseAutoSaveTimerRef.current)
      }
    }
  }, [data, dbState.pageDocId, dbState.pagesCollection, firebaseHydrated, saveDbPortfolio])

  const uploadHeroPortraitImage = useCallback(
    async (file) => {
      const image = await fileToDataUrl(file)
      const nextData = {
        ...data,
        hero: {
          ...data.hero,
          portraitImage: image,
        },
      }

      setData(nextData)
      await saveDbPortfolio(nextData)
    },
    [data, saveDbPortfolio],
  )

  const uploadInterviewPortraitImage = useCallback(
    async (file) => {
      const image = await fileToDataUrl(file)
      const nextData = {
        ...data,
        interview: {
          ...data.interview,
          portraitImage: image,
        },
      }

      setData(nextData)
      await saveDbPortfolio(nextData)
    },
    [data, saveDbPortfolio],
  )

  const uploadProjectImage = useCallback(
    async (projectId, file) => {
      const image = await fileToDataUrl(file)
      const nextData = {
        ...data,
        projects: {
          ...data.projects,
          items: data.projects.items.map((project) =>
            project.id === projectId ? { ...project, image } : project,
          ),
        },
      }

      setData(nextData)
      await saveDbPortfolio(nextData)
    },
    [data, saveDbPortfolio],
  )

  const fetchFirebaseProjects = async () => {
    const projectsCollection = dbState.projectsCollection.trim()

    if (!projectsCollection) {
      setFirebaseProjectsError('Firebase 프로젝트 컬렉션명을 먼저 입력해 주세요.')
      return
    }

    setFirebaseProjectsLoading(true)
    clearFirebaseProjectResults()

    try {
      const db = getFirebaseDb()
      const snapshots = await getDocs(query(collection(db, projectsCollection), orderBy('title')))
      const normalized = snapshots.docs
        .filter(Boolean)
        .map((snapshot) => ({ ...buildProjectFromFirebaseDoc({ id: snapshot.id, ...snapshot.data() }), source: 'firebase' }))

      setFirebaseProjects({ rows: normalized, lastFetchedAt: new Date().toISOString() })
      setFirebaseProjectsStatus(`${normalized.length}개 프로젝트를 불러왔습니다.`)
    } catch (error) {
      setFirebaseProjectsError(error instanceof Error ? error.message : '프로젝트 목록을 불러오지 못했습니다.')
    } finally {
      setFirebaseProjectsLoading(false)
    }
  }

  const importFirebaseProject = (row) => {
    const project = buildProjectFromFirebaseDoc(row)

    setData((prev) => {
      const index = prev.projects.items.findIndex(
        (item) =>
          item.firebaseId && item.firebaseId === project.firebaseId,
      )

      if (index === -1) {
        return {
          ...prev,
          projects: {
            ...prev.projects,
            items: [project, ...prev.projects.items],
          },
        }
      }

      return {
        ...prev,
        projects: {
          ...prev.projects,
          items: prev.projects.items.map((item, currentIndex) => (currentIndex === index ? { ...item, ...project, id: item.id } : item)),
        },
      }
    })
  }

  const importGithubRepo = async (repo, visible = true) => {
    try {
      setGithubLoading(true)
      clearGithubResults()

      const token = githubState.token.trim()
      const headers = buildGithubHeaders(token)

      const detailResponse = await fetch(`https://api.github.com/repos/${repo.fullName}`, { headers })
      const detail = detailResponse.ok ? await detailResponse.json() : repo
      const readmeText = await fetchGithubReadmeText(repo.fullName, token)
      const project = buildProjectFromRepo(
        {
          ...repo,
          ...detail,
          topics: Array.isArray(detail.topics) ? detail.topics : repo.topics,
          visible,
        },
        readmeText,
      )

      setData((prev) => {
        const index = prev.projects.items.findIndex((item) => item.repoUrl && item.repoUrl === project.repoUrl)
        if (index === -1) {
          return {
            ...prev,
            projects: {
              ...prev.projects,
              items: [project, ...prev.projects.items],
            },
          }
        }

        const nextItems = prev.projects.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...project, id: item.id, visible } : item,
        )

        return {
          ...prev,
          projects: {
            ...prev.projects,
            items: nextItems,
          },
        }
      })

      setGithubStatus(`"${project.title}" 프로젝트를 추가했습니다.`)
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : '프로젝트로 추가하지 못했습니다.')
    } finally {
      setGithubLoading(false)
    }
  }

  const toggleGithubRepoVisibility = async (repo, checked) => {
    if (checked) {
      await importGithubRepo(repo, true)
      return
    }

    setData((prev) => ({
      ...prev,
      projects: {
        ...prev.projects,
        items: prev.projects.items.map((item) =>
          item.repoUrl === repo.html_url ? { ...item, visible: false } : item,
        ),
      },
    }))
  }

  const addHeroMeta = () =>
    setData((prev) => ({
      ...prev,
      hero: {
        ...prev.hero,
        meta: [...prev.hero.meta, { id: createId(), label: '새 항목', value: '새 값' }],
      },
    }))

  const addHeroAction = () =>
    setData((prev) => ({
      ...prev,
      hero: {
        ...prev.hero,
        actions: [...prev.hero.actions, { id: createId(), label: '새 버튼', href: '#', variant: 'secondary' }],
      },
    }))

  const addInterviewQuestion = () =>
    setData((prev) => ({
      ...prev,
      interview: {
        ...prev.interview,
        questions: [...prev.interview.questions, { id: createId(), title: '새 질문', answer: '새 답변' }],
      },
    }))

  const addCareerItem = () =>
    setData((prev) => ({
      ...prev,
      career: {
        ...prev.career,
        items: [...prev.career.items, { id: createId(), title: '새 경력', desc: '설명을 입력하세요.', bullets: ['항목 1', '항목 2'] }],
      },
    }))

  const removeCareerItem = (itemId) =>
    setData((prev) => ({
      ...prev,
      career: {
        ...prev.career,
        items: prev.career.items.filter((item) => item.id !== itemId),
      },
    }))

  const addCareerBullet = (itemId) =>
    setData((prev) => ({
      ...prev,
      career: {
        ...prev.career,
        items: prev.career.items.map((item) =>
          item.id !== itemId ? item : { ...item, bullets: [...item.bullets, '새 항목'] },
        ),
      },
    }))

  const removeCareerBullet = (itemId, bulletIndex) =>
    setData((prev) => ({
      ...prev,
      career: {
        ...prev.career,
        items: prev.career.items.map((item) =>
          item.id !== itemId
            ? item
            : { ...item, bullets: item.bullets.filter((_, index) => index !== bulletIndex) },
        ),
      },
    }))

  const addSkillGroup = () =>
    setData((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        groups: [...prev.skills.groups, { id: createId(), title: '새 그룹', items: [{ id: createId(), name: '새 스킬', desc: '설명을 입력하세요.' }] }],
      },
    }))

  const addSkillItem = (groupId) =>
    setData((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        groups: prev.skills.groups.map((group) =>
          group.id !== groupId
            ? group
            : { ...group, items: [...group.items, { id: createId(), name: '새 스킬', desc: '설명을 입력하세요.' }] },
        ),
      },
    }))

  const addProject = () =>
    setData((prev) => ({
      ...prev,
      projects: {
        ...prev.projects,
        items: [
          ...prev.projects.items,
          {
            id: createId(),
            title: '새 프로젝트',
            type: '카테고리',
            tech: '',
            language: '',
            overview: '설명을 입력하세요.',
            purpose: '',
            image: '',
            repoUrl: '',
            repoFullName: '',
            source: 'manual',
            visible: true,
          },
        ],
      },
    }))

  const addContactButton = () =>
    setData((prev) => ({
      ...prev,
      contact: {
        ...prev.contact,
        buttons: [...prev.contact.buttons, { id: createId(), label: '새 버튼', href: '#', variant: 'secondary' }],
      },
    }))

  const resetData = () => {
    const next = clone(defaultData)
    setData(next)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    const nextGithub = { owner: '', token: '', repos: [], lastFetchedAt: '' }
    setGithubState(nextGithub)
    setGithubError('')
    setGithubStatus('')
    try {
      window.localStorage.setItem(GITHUB_STORAGE_KEY, JSON.stringify(nextGithub))
    } catch {
      // no-op
    }
  }

  const exportJson = useMemo(() => JSON.stringify(data, null, 2), [data])

  if (typeof window !== 'undefined' && window.__WHOMI_KEEP_UNUSED__) {
    void [
      splitLines,
      githubLoading,
      githubError,
      githubStatus,
      dbError,
      dbStatus,
      firebaseProjects,
      firebaseProjectsLoading,
      firebaseProjectsError,
      firebaseProjectsStatus,
      savedAt,
      updateNestedArrayItem,
      updateGithubSetting,
      updateDbSetting,
      fetchGithubRepos,
      fetchDbPortfolio,
      fetchFirebaseProjects,
      importFirebaseProject,
      importGithubRepo,
      addHeroMeta,
      addHeroAction,
      addInterviewQuestion,
      addCareerItem,
      addSkillGroup,
      addSkillItem,
      addProject,
      addContactButton,
      resetData,
      exportJson,
    ]
  }

  const visibleProjects = isSettingMode
    ? data.projects.items
    : data.projects.items.filter((project) => project.visible !== false)

  const edit = (props) => <EditableField enabled={isSettingMode} onSave={saveDbPortfolio} {...props} />
  const renderSettingsPanel = () => (
    <section className={`settings-inline-stack github-settings reveal-up ${isSettingsCollapsed ? 'is-collapsed' : ''}`} aria-label="GitHub 연동">
      <div className="settings-inline-header">
        <div>
          <p className="section-tag">GITHUB</p>
          <h2 className="section-title">깃허브 연동</h2>
          <p className="section-copy">아이디와 토큰으로 저장소 목록을 불러온 뒤, 체크박스로 프로젝트 섹션 표시 여부를 제어합니다.</p>
        </div>
        <div className="settings-inline-actions">
          {githubStatus ? <span className="settings-status">{githubStatus}</span> : null}
          {githubLoading ? <span className="settings-status">불러오는 중...</span> : null}
          <button
            className="settings-collapse-toggle"
            type="button"
            onClick={toggleSettingsCollapsed}
            aria-expanded={!isSettingsCollapsed}
            aria-label={isSettingsCollapsed ? '설정 펼치기' : '설정 접기'}
            title={isSettingsCollapsed ? '설정 펼치기 (Ctrl+Space)' : '설정 접기 (Ctrl+Space)'}
          >
            {isSettingsCollapsed ? '🔼' : '🔽'}
          </button>
        </div>
      </div>

      <div className="github-settings-grid">
        <label className="github-field">
          <span>GitHub 아이디</span>
          <input className="settings-input" value={githubState.owner} onChange={(event) => updateGithubSetting('owner', event.target.value)} placeholder="예: milkeon" />
        </label>
        <label className="github-field">
          <span>GitHub 토큰</span>
          <input className="settings-input" type="password" value={githubState.token} onChange={(event) => updateGithubSetting('token', event.target.value)} placeholder="ghp_..." />
        </label>
        <div className="github-actions">
          <button className="button primary" type="button" onClick={fetchGithubRepos} disabled={githubLoading}>저장소 불러오기</button>
        </div>
      </div>

      {githubError ? <p className="settings-error">{githubError}</p> : null}

      <div className="github-repo-list">
        {githubState.repos.length ? githubState.repos.map((repo) => {
          const isVisible = data.projects.items.some((item) => item.repoUrl === repo.html_url && item.visible !== false)
          return (
            <label className="github-repo-row" key={repo.fullName}>
              <input type="checkbox" checked={isVisible} onChange={(event) => toggleGithubRepoVisibility(repo, event.target.checked)} />
              <span className="github-repo-main">
                <strong>{repo.fullName}</strong>
                <span>{repo.description || '설명 없음'}</span>
              </span>
              <span className="github-repo-meta">{repo.language || '미지정'}</span>
            </label>
          )
        }) : <p className="settings-empty">저장소를 아직 불러오지 않았습니다.</p>}
      </div>
    </section>
  )

  const renderPortfolioPage = () => (
    <div className="page-shell">
      <header className="topbar reveal-up">
        <a className="brand" href="#home" aria-label="홈으로 이동">
          <span className="brand-dot" />
          <span className="brand-line">프론트-엔드</span>
          <span className="brand-divider">/</span>
          <span className="brand-line">이름1</span>
        </a>

        <nav className="nav" aria-label="주요 메뉴">
          <a href="#about">인터뷰</a>
          <a href="#career">이력</a>
          <a href="#skill">기술</a>
          <a href="#projects">프로젝트</a>
        </nav>
      </header>

      <main>
        <section className="hero reveal-up" id="home">
          <div className="hero-copy-column">
            {edit({
              wrapperTag: 'div',
              displayTag: 'p',
              displayClassName: 'hero-badge',
              value: data.hero.badge,
              placeholder: '배지 문구',
              className: 'hero-inline-editor hero-badge-editor',
              inputClassName: 'hero-inline-input',
              onChange: (value) => updateSection('hero', { badge: value }),
            })}
            {edit({
              wrapperTag: 'div',
              displayTag: 'p',
              displayClassName: 'hero-kicker',
              value: data.hero.kicker,
              placeholder: '상단 소개 문구',
              className: 'hero-inline-editor hero-kicker-editor',
              inputClassName: 'hero-inline-input',
              onChange: (value) => updateSection('hero', { kicker: value }),
            })}

            <h1 className="hero-title" aria-label={data.hero.titleLines.join(' ')}>
              {data.hero.titleLines.map((line, index) => (
                <span className="hero-title-line" key={`${line}-${index}`}>
                  {edit({
                    wrapperTag: 'span',
                    displayTag: 'span',
                    displayClassName: 'hero-title-line',
                    value: line,
                    placeholder: '제목',
                    className: 'hero-title-editor',
                    inputClassName: 'hero-inline-input hero-title-input',
                    onChange: (value) =>
                      setData((prev) => ({
                        ...prev,
                        hero: {
                          ...prev.hero,
                          titleLines: prev.hero.titleLines.map((current, currentIndex) =>
                            currentIndex === index ? value : current,
                          ),
                        },
                      })),
                  })}
                </span>
              ))}
            </h1>

            {edit({
              wrapperTag: 'div',
              displayTag: 'p',
              displayClassName: 'hero-copy',
              value: data.hero.copy,
              placeholder: '소개 문구',
              multiline: true,
              rows: 4,
              className: 'hero-copy-editor',
              inputClassName: 'hero-inline-input hero-copy-input',
              onChange: (value) => updateSection('hero', { copy: value }),
            })}

            <div className="hero-meta">
              {data.hero.meta.map((item) => (
                <div className="meta-chip" key={item.id}>
                  {edit({
                    wrapperTag: 'span',
                    displayTag: 'span',
                    displayClassName: 'meta-chip-label',
                    value: item.label,
                    placeholder: '항목명',
                    className: 'meta-chip-editor meta-chip-label-editor',
                    inputClassName: 'hero-inline-input meta-chip-input',
                    onChange: (value) => updateArrayItem('hero', 'meta', item.id, { label: value }),
                  })}
                  {edit({
                    wrapperTag: 'span',
                    displayTag: 'strong',
                    displayClassName: 'meta-chip-value',
                    value: item.value,
                    placeholder: '내용',
                    className: 'meta-chip-editor meta-chip-value-editor',
                    inputClassName: 'hero-inline-input meta-chip-input',
                    onChange: (value) => updateArrayItem('hero', 'meta', item.id, { value }),
                  })}
                </div>
              ))}
            </div>

            <div className="hero-actions">
              {data.hero.actions.map((action) => (
                <div className="hero-action-item" key={action.id}>
                  {edit({
                    wrapperTag: 'div',
                    displayTag: 'a',
                    displayProps: {
                      href: action.href,
                      className: `button ${action.variant === 'primary' ? 'primary' : 'secondary'}`,
                    },
                    displayClassName: '',
                    value: action.label,
                    placeholder: '버튼명',
                    className: 'hero-action-editor hero-action-label-editor',
                    inputClassName: 'hero-inline-input hero-action-input',
                    onChange: (value) => updateArrayItem('hero', 'actions', action.id, { label: value }),
                  })}
                  {edit({
                    wrapperTag: 'div',
                    displayTag: 'span',
                    displayClassName: 'hero-action-href',
                    value: action.href,
                    placeholder: '#링크',
                    className: 'hero-action-editor hero-action-href-editor',
                    inputClassName: 'hero-inline-input hero-action-input',
                    onChange: (value) => updateArrayItem('hero', 'actions', action.id, { href: value }),
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="hero-portrait" aria-label="사진1 영역">
            <div className="hero-orb hero-orb-1" />
            <div className="hero-orb hero-orb-2" />
            <div className="portrait-frame">
              <div className="portrait-photo">
                {edit({
                  wrapperTag: 'div',
                  displayTag: 'span',
                  displayClassName: 'portrait-label',
                  value: data.hero.portraitLabel,
                  placeholder: '사진 라벨',
                  className: 'portrait-label-editor',
                  inputClassName: 'hero-inline-input portrait-input',
                  onChange: (value) => updateSection('hero', { portraitLabel: value }),
                })}
                {isSettingMode ? (
                  <div className="portrait-photo-toolbar">
                    <ImageUploadControl
                      buttonLabel={data.hero.portraitImage ? '이미지 변경' : '이미지 추가'}
                      className="image-upload-overlay image-upload-overlay--hero"
                      onUpload={uploadHeroPortraitImage}
                    />
                  </div>
                ) : null}
                <div className="portrait-art" aria-hidden="true">
                  {data.hero.portraitImage ? (
                    <img className="portrait-upload" src={data.hero.portraitImage} alt="" />
                  ) : (
                    <>
                      <div className="portrait-face" />
                      <div className="portrait-glow portrait-glow-1" />
                      <div className="portrait-glow portrait-glow-2" />
                    </>
                  )}
                </div>
                <div className="portrait-caption">
                  {edit({
                    wrapperTag: 'span',
                    displayTag: 'span',
                    displayClassName: 'portrait-caption-top',
                    value: data.hero.portraitCaptionTop,
                    placeholder: '상단 캡션',
                    className: 'portrait-caption-editor',
                    inputClassName: 'hero-inline-input portrait-input',
                    onChange: (value) => updateSection('hero', { portraitCaptionTop: value }),
                  })}
                  {edit({
                    wrapperTag: 'strong',
                    displayTag: 'strong',
                    displayClassName: 'portrait-caption-bottom',
                    value: data.hero.portraitCaptionBottom,
                    placeholder: '하단 캡션',
                    className: 'portrait-caption-editor',
                    inputClassName: 'hero-inline-input portrait-input',
                    onChange: (value) => updateSection('hero', { portraitCaptionBottom: value }),
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>


        <section className="section-interview section-grid reveal-up" id="about">
          <div className="section-heading about-panel">
            {edit({
              wrapperTag: 'div',
              displayTag: 'p',
              displayClassName: 'section-tag',
              value: data.interview.tag,
              placeholder: '섹션 태그',
              className: 'section-inline-editor',
              inputClassName: 'section-inline-input',
              onChange: (value) => updateSection('interview', { tag: value }),
            })}
            {data.interview.questions.map((question, index) => (
              <div key={question.id} className="about-question-block">
                {edit({
                  wrapperTag: 'div',
                  displayTag: 'h2',
                  displayClassName: `section-title${index > 0 ? ' small' : ''}`,
                  value: question.title,
                  placeholder: '질문 제목',
                  className: 'section-inline-editor',
                  inputClassName: 'section-inline-input section-title-input',
                  onChange: (value) => updateArrayItem('interview', 'questions', question.id, { title: value }),
                })}
                {edit({
                  wrapperTag: 'div',
                  displayTag: 'p',
                  displayClassName: 'section-copy',
                  value: question.answer,
                  placeholder: '답변',
                  multiline: true,
                  rows: 4,
                  className: 'section-inline-editor',
                  inputClassName: 'section-inline-input section-copy-input',
                  onChange: (value) => updateArrayItem('interview', 'questions', question.id, { answer: value }),
                })}
              </div>
            ))}
          </div>

          <div className="interview-portrait">
            <div className="interview-photo">
              {isSettingMode ? (
                <div className="image-upload-inline-wrap">
                  <ImageUploadControl
                    buttonLabel={data.interview.portraitImage ? '이미지 변경' : '이미지 추가'}
                    className="image-upload-inline image-upload-inline--photo"
                    onUpload={uploadInterviewPortraitImage}
                  />
                </div>
              ) : null}
              {data.interview.portraitImage ? (
                <img className="interview-photo-image upload-photo" src={data.interview.portraitImage} alt={data.interview.portraitLabel} />
              ) : (
                <div className="interview-photo-placeholder">
                  {edit({
                    wrapperTag: 'div',
                    displayTag: 'span',
                    displayClassName: 'interview-photo-text',
                    value: data.interview.portraitLabel,
                    placeholder: '인물 라벨',
                    className: 'section-inline-editor',
                    inputClassName: 'section-inline-input',
                    onChange: (value) => updateSection('interview', { portraitLabel: value }),
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="section-grid section-career reveal-up" id="career">
          <div className="section-heading">
            <div className="section-heading-row">
              {edit({
                wrapperTag: 'div',
                displayTag: 'p',
                displayClassName: 'section-tag',
                value: data.career.tag,
                placeholder: '섹션 태그',
                className: 'section-inline-editor',
                inputClassName: 'section-inline-input',
                onChange: (value) => updateSection('career', { tag: value }),
              })}
              {isSettingMode ? (
                <button className="button secondary small" type="button" onClick={addCareerItem}>
                  경력 추가
                </button>
              ) : null}
            </div>
            {edit({
              wrapperTag: 'div',
              displayTag: 'h2',
              displayClassName: 'section-title',
              value: data.career.title,
              placeholder: '섹션 제목',
              className: 'section-inline-editor',
              inputClassName: 'section-inline-input section-title-input',
              onChange: (value) => updateSection('career', { title: value }),
            })}
            {edit({
              wrapperTag: 'div',
              displayTag: 'p',
              displayClassName: 'section-copy',
              value: data.career.copy,
              placeholder: '섹션 설명',
              multiline: true,
              rows: 3,
              className: 'section-inline-editor',
              inputClassName: 'section-inline-input section-copy-input',
              onChange: (value) => updateSection('career', { copy: value }),
            })}
          </div>

          <div className="career-stack">
            {data.career.items.map((item) => (
              <article className="career-card reveal-up" key={item.id}>
                {isSettingMode ? (
                  <div className="career-card-actions">
                    <button className="button secondary small" type="button" onClick={() => addCareerBullet(item.id)}>
                      항목 추가
                    </button>
                    <button className="button danger small" type="button" onClick={() => removeCareerItem(item.id)}>
                      삭제
                    </button>
                  </div>
                ) : null}
                {edit({
                  wrapperTag: 'div',
                  displayTag: 'h3',
                  displayClassName: 'career-card-title',
                  value: item.title,
                  placeholder: '경력명',
                  className: 'card-inline-editor',
                  inputClassName: 'card-inline-input',
                  onChange: (value) => updateArrayItem('career', 'items', item.id, { title: value }),
                })}
                {edit({
                  wrapperTag: 'div',
                  displayTag: 'p',
                  displayClassName: 'career-card-desc',
                  value: item.desc,
                  placeholder: '경력 설명',
                  multiline: true,
                  rows: 3,
                  className: 'card-inline-editor',
                  inputClassName: 'card-inline-input card-textarea-input',
                  onChange: (value) => updateArrayItem('career', 'items', item.id, { desc: value }),
                })}
                <ul className="career-bullet-list">
                  {item.bullets.map((bullet, bulletIndex) => (
                    <li className="career-bullet-item" key={`${item.id}-${bulletIndex}`}>
                      {edit({
                        wrapperTag: 'span',
                        displayTag: 'span',
                        displayClassName: 'career-bullet',
                        value: bullet,
                        placeholder: '불릿',
                        className: 'card-inline-editor card-bullet-editor',
                        inputClassName: 'card-inline-input',
                        onChange: (value) =>
                          updateArrayItem('career', 'items', item.id, {
                            bullets: item.bullets.map((currentBullet, currentBulletIndex) =>
                              currentBulletIndex === bulletIndex ? value : currentBullet,
                            ),
                          }),
                      })}
                      {isSettingMode ? (
                        <button className="button secondary tiny" type="button" onClick={() => removeCareerBullet(item.id, bulletIndex)}>
                          삭제
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {isSettingMode ? (
                  <div className="career-card-footer">
                    <button className="button secondary small" type="button" onClick={() => addCareerBullet(item.id)}>
                      항목 추가
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="section-skills skill-stage" id="skill">
          <div className="skill-rail" aria-hidden="true">
            <span className="rail-dot" />
            {edit({
              wrapperTag: 'span',
              displayTag: 'span',
              displayClassName: 'rail-word',
              value: data.skills.railWord,
              placeholder: '철도 문구',
              className: 'rail-inline-editor',
              inputClassName: 'rail-inline-input',
              onChange: (value) => updateSection('skills', { railWord: value }),
            })}
            <span className="rail-line" />
            {edit({
              wrapperTag: 'span',
              displayTag: 'span',
              displayClassName: 'rail-index',
              value: data.skills.railIndex,
              placeholder: '연도',
              className: 'rail-inline-editor',
              inputClassName: 'rail-inline-input',
              onChange: (value) => updateSection('skills', { railIndex: value }),
            })}
          </div>

          <div className="skill-content">
            <div className="skill-marquee" aria-hidden="true">
              <span>{data.skills.marquee}</span>
              <span>{data.skills.marquee}</span>
            </div>

            <div className="skill-bottom-word" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <span key={`${data.skills.bottomWord}-${index}`}>{data.skills.bottomWord}</span>
              ))}
            </div>

            {data.skills.groups.map((group, index) => (
              <div
                className={`skill-column ${SKILL_COLUMN_CLASSES[index]}`}
                key={group.id}
              >
                <div className={`skill-card ${SKILL_CARD_CLASSES[index]} reveal-up`}>
                  {edit({
                    wrapperTag: 'div',
                    displayTag: 'h2',
                    displayClassName: 'skill-card-title',
                    value: group.title,
                    placeholder: '스킬 그룹명',
                    className: 'card-inline-editor',
                    inputClassName: 'card-inline-input',
                    onChange: (value) =>
                      setData((prev) => ({
                        ...prev,
                        skills: {
                          ...prev.skills,
                          groups: prev.skills.groups.map((currentGroup) =>
                            currentGroup.id === group.id ? { ...currentGroup, title: value } : currentGroup,
                          ),
                        },
                      })),
                  })}
                  {group.items.map((item) => (
                    <div className="skill-row" key={item.id}>
                      {edit({
                        wrapperTag: 'div',
                        displayTag: 'strong',
                        displayClassName: 'skill-row-name',
                        value: item.name,
                        placeholder: '기술명',
                        className: 'card-inline-editor',
                        inputClassName: 'card-inline-input',
                        onChange: (value) =>
                          updateNestedArrayItem('skills', 'groups', group.id, 'items', item.id, { name: value }),
                      })}
                      {edit({
                        wrapperTag: 'div',
                        displayTag: 'p',
                        displayClassName: 'skill-row-desc',
                        value: item.desc,
                        placeholder: '설명',
                        multiline: true,
                        rows: 3,
                        className: 'card-inline-editor',
                        inputClassName: 'card-inline-input card-textarea-input',
                        onChange: (value) =>
                          updateNestedArrayItem('skills', 'groups', group.id, 'items', item.id, { desc: value }),
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section-projects" id="projects">
          <div className="projects-header reveal-up">
            {edit({
              wrapperTag: 'div',
              displayTag: 'p',
              displayClassName: 'section-tag',
              value: data.projects.tag,
              placeholder: '섹션 태그',
              className: 'section-inline-editor',
              inputClassName: 'section-inline-input',
              onChange: (value) => updateSection('projects', { tag: value }),
            })}
            {edit({
              wrapperTag: 'div',
              displayTag: 'h2',
              displayClassName: 'section-title',
              value: data.projects.title,
              placeholder: '섹션 제목',
              className: 'section-inline-editor',
              inputClassName: 'section-inline-input section-title-input',
              onChange: (value) => updateSection('projects', { title: value }),
            })}
          </div>

          <div className="project-list">
            {visibleProjects.map((project, index) => (
              <article className={`project-card reveal-up ${index % 2 === 0 ? 'from-right' : 'from-left'}`} key={project.id}>
                <div className="project-media">
                  {isSettingMode ? (
                    <div className="image-upload-inline-wrap image-upload-inline-wrap--media">
                      <ImageUploadControl
                        buttonLabel={project.image ? '이미지 변경' : '이미지 추가'}
                        className="image-upload-inline image-upload-inline--media"
                        onUpload={(file) => uploadProjectImage(project.id, file)}
                      />
                    </div>
                  ) : null}
                  <span className="project-media-tag">/</span>
                  {project.image ? <img className="project-image" src={project.image} alt={project.title} /> : <div className="project-image project-image-empty" aria-hidden="true" />}
                  {isSettingMode && project.visible === false ? <span className="project-hidden-badge">숨김</span> : null}
                </div>
                <div className="project-content">
                  {edit({
                    wrapperTag: 'div',
                    displayTag: 'p',
                    displayClassName: 'project-type',
                    value: project.type,
                    placeholder: '프로젝트 타입',
                    className: 'card-inline-editor',
                    inputClassName: 'card-inline-input',
                    onChange: (value) => updateArrayItem('projects', 'items', project.id, { type: value }),
                  })}
                  {edit({
                    wrapperTag: 'div',
                    displayTag: 'h3',
                    displayClassName: 'project-title',
                    value: project.title,
                    placeholder: '프로젝트명',
                    className: 'card-inline-editor',
                    inputClassName: 'card-inline-input',
                    onChange: (value) => updateArrayItem('projects', 'items', project.id, { title: value }),
                  })}
                  <div className="project-details">
                    <div>
                      <span>기술</span>
                      {edit({
                        wrapperTag: 'div',
                        displayTag: 'strong',
                        displayClassName: 'project-detail-value',
                        value: project.tech,
                        placeholder: '기술 스택',
                        className: 'card-inline-editor',
                        inputClassName: 'card-inline-input',
                        onChange: (value) => updateArrayItem('projects', 'items', project.id, { tech: value }),
                      })}
                    </div>
                    <div>
                      <span>언어</span>
                      {edit({
                        wrapperTag: 'div',
                        displayTag: 'strong',
                        displayClassName: 'project-detail-value',
                        value: project.language,
                        placeholder: '언어',
                        className: 'card-inline-editor',
                        inputClassName: 'card-inline-input',
                        onChange: (value) => updateArrayItem('projects', 'items', project.id, { language: value }),
                      })}
                    </div>
                  </div>
                  {edit({
                    wrapperTag: 'div',
                    displayTag: 'p',
                    displayClassName: 'project-overview',
                    value: project.overview || project.desc || '',
                    placeholder: '개요',
                    multiline: true,
                    rows: 4,
                    className: 'card-inline-editor',
                    inputClassName: 'card-inline-input card-textarea-input',
                    onChange: (value) => updateArrayItem('projects', 'items', project.id, { overview: value }),
                  })}
                  {edit({
                    wrapperTag: 'div',
                    displayTag: 'p',
                    displayClassName: 'project-purpose',
                    value: project.purpose || '',
                    placeholder: '목적',
                    multiline: true,
                    rows: 3,
                    className: 'card-inline-editor',
                    inputClassName: 'card-inline-input card-textarea-input',
                    onChange: (value) => updateArrayItem('projects', 'items', project.id, { purpose: value }),
                  })}
                  {project.repoUrl ? (
                    edit({
                      wrapperTag: 'div',
                      displayTag: 'a',
                      displayProps: {
                        href: project.repoUrl,
                        target: '_blank',
                        rel: 'noreferrer',
                        className: 'project-link',
                      },
                      displayClassName: 'project-link',
                      value: project.repoUrl,
                      placeholder: 'GitHub URL',
                      className: 'card-inline-editor',
                      inputClassName: 'card-inline-input',
                      onChange: (value) => updateArrayItem('projects', 'items', project.id, { repoUrl: value }),
                    })
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="contact-panel reveal-up" id="contact">
          <div>
            {edit({
              wrapperTag: 'div',
              displayTag: 'p',
              displayClassName: 'section-tag',
              value: data.contact.tag,
              placeholder: '섹션 태그',
              className: 'section-inline-editor',
              inputClassName: 'section-inline-input',
              onChange: (value) => updateSection('contact', { tag: value }),
            })}
            {edit({
              wrapperTag: 'div',
              displayTag: 'h2',
              displayClassName: 'section-title',
              value: data.contact.title,
              placeholder: '연락처 제목',
              className: 'section-inline-editor',
              inputClassName: 'section-inline-input section-title-input',
              onChange: (value) => updateSection('contact', { title: value }),
            })}
            {edit({
              wrapperTag: 'div',
              displayTag: 'p',
              displayClassName: 'section-copy',
              value: data.contact.copy,
              placeholder: '연락처 설명',
              multiline: true,
              rows: 3,
              className: 'section-inline-editor',
              inputClassName: 'section-inline-input section-copy-input',
              onChange: (value) => updateSection('contact', { copy: value }),
            })}
          </div>
          <div className="contact-links">
            {data.contact.buttons.map((button) => (
              <div className="contact-button-editor" key={button.id}>
                {edit({
                  wrapperTag: 'div',
                  displayTag: 'a',
                  displayProps: {
                    href: button.href,
                    className: `button ${button.variant === 'primary' ? 'primary' : 'secondary'}`,
                  },
                  value: button.label,
                  placeholder: '버튼명',
                  className: 'hero-action-editor hero-action-label-editor',
                  inputClassName: 'hero-inline-input hero-action-input',
                  onChange: (value) => updateArrayItem('contact', 'buttons', button.id, { label: value }),
                })}
                {edit({
                  wrapperTag: 'div',
                  displayTag: 'span',
                  displayClassName: 'contact-button-href',
                  value: button.href,
                  placeholder: '링크',
                  className: 'hero-action-editor hero-action-href-editor',
                  inputClassName: 'hero-inline-input hero-action-input',
                  onChange: (value) => updateArrayItem('contact', 'buttons', button.id, { href: value }),
                })}
              </div>
            ))}
            <a className="button secondary" href="#setting">
              설정 열기
            </a>
          </div>
        </section>
      </main>
    </div>
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    window.__WHOMI_SAVE__ = saveDbPortfolio
    return () => {
      if (window.__WHOMI_SAVE__ === saveDbPortfolio) {
        delete window.__WHOMI_SAVE__
      }
    }
  }, [saveDbPortfolio])

  return mode === 'setting' ? (
    <div className="settings-dual-view">
      {renderPortfolioPage()}
      <div className={`settings-drawer ${isSettingsCollapsed ? 'is-collapsed' : ''}`}>
        {renderSettingsPanel()}
      </div>
    </div>
  ) : (
    renderPortfolioPage()
  )
}

export default App
