export interface DlsiteTag {
  name: string
  category: string
}

export interface DlsiteMeta {
  rj_code: string
  title: string
  circle: string
  release_date: string
  series: string
  sales_count: number | null
  actors: string[]
  tags: DlsiteTag[]
  cover_url: string
}
