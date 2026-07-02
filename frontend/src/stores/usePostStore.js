import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { socialApi } from '@/api/social'
import { useAuthStore } from './auth'
import { useToast } from '@/composables/useToast'

export const usePostStore = defineStore('post', () => {
  const posts = ref([])
  const isLoading = ref(false)
  const pagination = ref({
    page: 1,
    limit: 10,
    hasMore: true
  })

  const authStore = useAuthStore()
  const { error: showError, success: showSuccess } = useToast()

  const getErrorMessage = (err, fallback) =>
    err?.response?.data?.error || err?.response?.data?.message || err?.message || fallback

  const postsWithAuth = computed(() => {
    return posts.value.map((p) => {
      const isMine = p.authorId === authStore.user?.id
      return {
        ...p,
        isMine,
        // 如果是自己的貼文，則即時連動 authStore 的最新個人資料
        authorAvatar: isMine ? authStore.profile?.avatar_url || p.authorAvatar : p.authorAvatar,
        author: isMine ? authStore.profile?.nick_name || p.author : p.author
      }
    })
  })
  const fetchPosts = async ({ page = 1, limit = 10, loadMore = false, ...otherParams } = {}) => {
    if (isLoading.value) return
    if (loadMore && !pagination.value.hasMore) return

    isLoading.value = true
    try {
      const params = { page, limit, ...otherParams }
      const res = await socialApi.getPosts(params)
      const data = Array.isArray(res.data) ? res.data : res.data?.data || []
      const hasNext = data.length >= limit

      if (loadMore) {
        posts.value.push(...data)
      } else {
        posts.value = data
      }
      applyPendingLikeStates()

      pagination.value = {
        page,
        limit,
        hasMore: hasNext
      }
    } catch (err) {
      showError(getErrorMessage(err, '貼文載入失敗，請稍後再試'))
    } finally {
      isLoading.value = false
    }
  }

  // 已收藏的貼文列表
  const bookmarkedPosts = ref([])

  const fetchBookmarkedPosts = async () => {
    try {
      const res = await socialApi.getBookmarkedPosts()
      console.log('[fetchBookmarkedPosts] API response:', res)
      const data = Array.isArray(res.data) ? res.data : res.data?.data || []
      console.log('[fetchBookmarkedPosts] Processed data:', data)
      bookmarkedPosts.value = data
      applyPendingLikeStates()
    } catch (err) {
      console.error('[fetchBookmarkedPosts] Error:', err)
      showError(getErrorMessage(err, '收藏貼文載入失敗，請稍後再試'))
    }
  }

  const createPost = async (content, imageUrls = [], audience = 'public') => {
    if (!authStore.user?.id) {
      const msg = '請先登入'
      showError(msg)
      throw new Error(msg)
    }

    const lockKey = 'create_post'
    if (activeRequests.has(lockKey)) return null
    activeRequests.add(lockKey)

    try {
      const res = await socialApi.createPost({
        content,
        imageUrls,
        audience,
        userId: authStore.user.id
      })

      const newPost = res.data || res

      if (newPost) {
        posts.value.unshift(newPost)

        // New post animation handling
        if (newPost.isNew) {
          setTimeout(() => {
            const p = posts.value.find((x) => x.id === newPost.id)
            if (p) p.isNew = false
          }, 3000)
        }
        return newPost
      }
    } catch (err) {
      showError(getErrorMessage(err, '貼文發布失敗，請稍後再試'))
      throw err
    } finally {
      activeRequests.delete(lockKey)
    }
  }

  // 更新貼文
  const updatePost = async (id, payload) => {
    const post = posts.value.find((p) => p.id === id)
    const previousPost = post ? { ...post } : null
    if (post) {
      Object.assign(post, payload)
    }

    try {
      await socialApi.updatePost(id, payload)
    } catch (err) {
      // TODO: 必要時還原邏輯 (目前沒有簡單的還原機制，暫時忽略)
      if (post && previousPost) {
        Object.assign(post, previousPost)
      }
      showError(getErrorMessage(err, '更新貼文失敗，請稍後再試'))
    }
  }

  // 用來避免重複點擊的請求鎖
  const activeRequests = new Set()
  const LIKE_SYNC_DELAY = 500
  const LIKE_SYNC_STORAGE_KEY = 'pendingPostLikes'
  const likeSyncStates = new Map()

  const readPendingLikeStates = () => {
    if (typeof window === 'undefined') return {}

    try {
      return JSON.parse(localStorage.getItem(LIKE_SYNC_STORAGE_KEY) || '{}')
    } catch {
      return {}
    }
  }

  const writePendingLikeStates = (pendingStates) => {
    if (typeof window === 'undefined') return

    const entries = Object.entries(pendingStates)
    if (entries.length === 0) {
      localStorage.removeItem(LIKE_SYNC_STORAGE_KEY)
      return
    }

    localStorage.setItem(LIKE_SYNC_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  }

  const persistPendingLikeState = (id, isLiked) => {
    const pendingStates = readPendingLikeStates()
    pendingStates[String(id)] = isLiked
    writePendingLikeStates(pendingStates)
  }

  const clearPendingLikeState = (id) => {
    const pendingStates = readPendingLikeStates()
    delete pendingStates[String(id)]
    writePendingLikeStates(pendingStates)
  }

  const getPostRefsById = (id) => {
    const refs = [...posts.value, ...bookmarkedPosts.value].filter((p) => p?.id == id)
    return refs.filter((post, index) => refs.indexOf(post) === index)
  }

  const setPostLikeState = (id, isLiked, likeCount) => {
    getPostRefsById(id).forEach((post) => {
      post.isLiked = isLiked
      post.likeCount = Math.max(0, likeCount)
    })
  }

  const applyOptimisticLikeState = (id, nextIsLiked) => {
    getPostRefsById(id).forEach((post) => {
      const wasLiked = !!post.isLiked
      post.isLiked = nextIsLiked

      if (wasLiked !== nextIsLiked) {
        post.likeCount = Math.max(0, (post.likeCount || 0) + (nextIsLiked ? 1 : -1))
      }
    })
  }

  const getLikeSyncState = (id, post) => {
    const key = String(id)
    const existingState = likeSyncStates.get(key)
    if (existingState) return existingState

    const state = {
      confirmedIsLiked: !!post.isLiked,
      confirmedLikeCount: post.likeCount || 0,
      desiredIsLiked: !!post.isLiked,
      timer: null,
      isSyncing: false,
      localVersion: 0
    }

    likeSyncStates.set(key, state)
    return state
  }

  const syncLikeState = async (id, state) => {
    if (state.isSyncing) return

    const desiredIsLiked = state.desiredIsLiked
    const syncVersion = state.localVersion

    if (desiredIsLiked === state.confirmedIsLiked) {
      clearPendingLikeState(id)
      return
    }

    state.isSyncing = true

    try {
      if (desiredIsLiked) {
        await socialApi.likePost(id)
      } else {
        await socialApi.unlikePost(id)
      }

      const countDelta = desiredIsLiked ? 1 : -1
      state.confirmedIsLiked = desiredIsLiked
      state.confirmedLikeCount = Math.max(0, state.confirmedLikeCount + countDelta)
      clearPendingLikeState(id)
      showSuccess(desiredIsLiked ? '已按讚' : '已取消按讚')
    } catch (err) {
      if (state.localVersion === syncVersion) {
        state.desiredIsLiked = state.confirmedIsLiked
        setPostLikeState(id, state.confirmedIsLiked, state.confirmedLikeCount)
        clearPendingLikeState(id)
      }
      showError(getErrorMessage(err, '操作失敗，請稍後再試'))
    } finally {
      state.isSyncing = false

      if (state.desiredIsLiked !== state.confirmedIsLiked) {
        scheduleLikeSync(id, state)
      }
    }
  }

  function scheduleLikeSync(id, state) {
    if (state.timer) clearTimeout(state.timer)

    state.timer = setTimeout(() => {
      state.timer = null
      syncLikeState(id, state)
    }, LIKE_SYNC_DELAY)
  }

  // 按讚
  const likePost = (id) => {
    const post = getPostRefsById(id)[0]
    if (!post) return

    const state = getLikeSyncState(id, post)
    const nextIsLiked = !post.isLiked
    state.desiredIsLiked = nextIsLiked
    state.localVersion += 1

    applyOptimisticLikeState(id, nextIsLiked)
    if (nextIsLiked === state.confirmedIsLiked) {
      clearPendingLikeState(id)
    } else {
      persistPendingLikeState(id, nextIsLiked)
    }
    scheduleLikeSync(id, state)
  }

  const applyPendingLikeStates = () => {
    const pendingStates = readPendingLikeStates()

    Object.entries(pendingStates).forEach(([id, desiredIsLiked]) => {
      const post = getPostRefsById(id)[0]
      if (!post) return

      const state = getLikeSyncState(id, post)
      state.desiredIsLiked = desiredIsLiked

      if (desiredIsLiked === state.confirmedIsLiked) {
        clearPendingLikeState(id)
        return
      }

      applyOptimisticLikeState(id, desiredIsLiked)
      scheduleLikeSync(id, state)
    })
  }

  // 收藏
  const bookmarkPost = async (id) => {
    // 使用寬鬆比較以避免型別問題 (string vs number)
    const post = posts.value.find((p) => p.id == id)
    if (!post) {
      console.warn('[bookmarkPost] Post not found in store:', id)
      return
    }

    const lockKey = `bookmark_${id}`
    if (activeRequests.has(lockKey)) return
    activeRequests.add(lockKey)

    const originalState = post.isBookmarked
    // 強制更新屬性，確保 Vue 偵測到變化
    post.isBookmarked = !originalState
    console.log(`[bookmarkPost] Toggling bookmark for ${id} to ${post.isBookmarked}`)

    try {
      if (post.isBookmarked) {
        await socialApi.bookmarkPost(id)
        // 檢查是否已存在於收藏列表中
        const exists = bookmarkedPosts.value.some((p) => p.id == id)
        if (!exists) {
          bookmarkedPosts.value.unshift(post)
        }
      } else {
        await socialApi.unbookmarkPost(id)
        bookmarkedPosts.value = bookmarkedPosts.value.filter((p) => p.id != id)
      }
    } catch (err) {
      post.isBookmarked = originalState
      showError(getErrorMessage(err, '操作失敗，請稍後再試'))
      throw err // 拋出錯誤讓 Component 知道失敗了
    } finally {
      activeRequests.delete(lockKey)
    }
  }

  // 刪除貼文
  const deletePost = async (id) => {
    const post = posts.value.find((p) => p.id === id)
    if (post) {
      post.isDeleted = true
    }

    try {
      await socialApi.deletePost(id)
    } catch (error) {
      if (post) {
        post.isDeleted = false
      }
      showError(getErrorMessage(error, '刪除貼文失敗，請稍後再試'))
      throw error
    }
  }

  const updateCommentCount = (id, delta) => {
    getPostRefsById(id).forEach((post) => {
      post.commentCount = Math.max(0, (post.commentCount || 0) + delta)
    })
  }

  return {
    posts,
    postsWithAuth,
    bookmarkedPosts,
    isLoading,
    pagination,
    fetchPosts,
    fetchBookmarkedPosts,
    createPost,
    updatePost,
    likePost,
    bookmarkPost,
    deletePost,
    updateCommentCount
  }
})
