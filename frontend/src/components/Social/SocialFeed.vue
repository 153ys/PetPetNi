<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useInfiniteScroll } from '@vueuse/core'
import PostCard from '@/components/Social/PostCard.vue'
import PostSkeleton from '@/components/Social/PostSkeleton.vue'
import ImagePreviewModal from '@/components/Share/ImagePreviewModal.vue'
import { useScreen } from '@/composables/useScreen'
import { useActiveItem } from '@/composables/useActiveItem'
import { useToast } from '@/composables/useToast'
import { useImagePreview } from '@/composables/useImagePreview'
import { usePostStore } from '@/stores/usePostStore'
import { useAuthStore } from '@/stores/auth'

const postStore = usePostStore()
const authStore = useAuthStore()
const { success, error } = useToast()
const { isDesktop } = useScreen()
const { previewOpen, previewImages, previewIndex, openPreview, closePreview } = useImagePreview()

const commentManager = useActiveItem({
  enableClickOutside: isDesktop
})

const loadMoreTrigger = ref(null)

const visiblePosts = computed(() => postStore.postsWithAuth.filter((p) => !p.isDeleted))
const leftPosts = computed(() => visiblePosts.value.filter((_, i) => i % 2 === 0))
const rightPosts = computed(() => visiblePosts.value.filter((_, i) => i % 2 !== 0))
const isEmptyLoading = computed(() => postStore.isLoading && visiblePosts.value.length === 0)
const desktopColumns = computed(() => [leftPosts.value, rightPosts.value])

const openComments = (postId) => {
  if (commentManager.activeId.value === postId) {
    commentManager.deactivate()
  } else {
    commentManager.activate(postId)
  }
}

const toggleLike = async (postId) => {
  try {
    postStore.likePost(postId)
  } catch (err) {
    // 錯誤時的 toast 已經在 store 中由 showError 處理了
    // 這裡只需要 catch 住防止影響其他執行
  }
}

const toggleBookmark = async (postId) => {
  try {
    const post = postStore.posts.find((p) => p.id === postId)
    if (!post) return
    
    const wasBookmarked = post.isBookmarked
    await postStore.bookmarkPost(postId)

    if (post.isBookmarked !== wasBookmarked) {
      if (post.isBookmarked) {
        success('已收藏貼文')
      } else {
        success('已取消收藏')
      }
    }
  } catch (err) {
    console.error(err)
    // 錯誤時的 toast 已在 store 處理
  }
}

const handleUpdate = async (payload) => {
  await postStore.updatePost(payload.id, {
    content: payload.content,
    audience: payload.audience,
    images: payload.images
  })
  success('貼文已更新')
}
const sharePost = async (payload) => {
  if (payload?.url) {
    try {
      await navigator.clipboard.writeText(payload.url)
      success('連結已複製')
    } catch {
      error('複製失敗')
    }
  }
}

const handleDelete = async (postId) => {
  try {
    await postStore.deletePost(postId)
    success('貼文已刪除')
  } catch (error) {
    console.error(error)
    error('刪除失敗')
  }
}

const handleCommentAdded = (postId) => postStore.updateCommentCount(postId, 1)
const handleCommentDeleted = (postId) => postStore.updateCommentCount(postId, -1)
const postCardEvents = {
  update: handleUpdate,
  'preview-image': openPreview,
  like: toggleLike,
  'open-comments': openComments,
  'close-comments': commentManager.deactivate,
  share: sharePost,
  bookmark: toggleBookmark,
  delete: handleDelete,
  'comment-added': handleCommentAdded,
  'comment-deleted': handleCommentDeleted
}

onMounted(() => {
  postStore.fetchPosts()
})

useInfiniteScroll(
  loadMoreTrigger,
  () => {
    if (postStore.pagination.hasMore && !postStore.isLoading) {
      postStore.fetchPosts({
        page: postStore.pagination.page + 1,
        loadMore: true
      })
    }
  },
  { distance: 10 }
)

watch(
  () => authStore.user,
  (newUser) => {
    if (newUser) {
      postStore.fetchPosts()
    }
  }
)
</script>

<template>
  <div>
    <!-- 手機/平板：單欄 -->
    <section v-if="!isDesktop" class="mt-4 flex flex-col gap-4">
      <div v-if="isEmptyLoading" class="flex flex-col gap-4">
        <PostSkeleton v-for="i in 3" :key="i" />
      </div>
      <PostCard
        v-for="p in visiblePosts"
        :key="p.id"
        :ref="(el) => commentManager.registerRef(p.id, el)"
        :post="p"
        :show-comments="commentManager.activeId.value === p.id"
        v-on="postCardEvents"
      />
    </section>

    <!-- 桌機：雙欄 -->
    <section class="mt-4 hidden w-full grid-cols-2 gap-4 md:grid">
      <div v-for="(colPosts, index) in desktopColumns" :key="index" class="flex flex-col gap-4">
        <!-- Skeleton Loading -->
        <div v-if="isEmptyLoading" class="flex flex-col gap-4">
          <PostSkeleton v-for="i in 2" :key="i" />
        </div>

        <PostCard
          v-for="p in colPosts"
          :key="p.id"
          :ref="(el) => commentManager.registerRef(p.id, el)"
          :post="p"
          :show-comments="commentManager.activeId.value === p.id"
          v-on="postCardEvents"
        />
      </div>
    </section>

    <!-- loading (純視覺) -->
    <div ref="loadMoreTrigger" class="grid place-items-center py-10 text-zinc-500">
      <div
        v-if="postStore.isLoading"
        class="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent"
      ></div>
      <span v-else-if="!postStore.pagination.hasMore">沒有更多貼文了🐾</span>
    </div>

    <!-- 圖片預覽 Modal -->
    <ImagePreviewModal
      v-model:index="previewIndex"
      :open="previewOpen"
      :images="previewImages"
      @close="closePreview"
    />
  </div>
</template>
