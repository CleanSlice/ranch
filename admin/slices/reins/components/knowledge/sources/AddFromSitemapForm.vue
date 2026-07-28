<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';

const props = defineProps<{ knowledgeId: string }>();
const emit = defineEmits<{ added: [] }>();

const store = useKnowledgeStore();
const open = ref(false);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const sitemapUrl = ref('');
const urlPrefix = ref('');

function reset() {
  sitemapUrl.value = '';
  urlPrefix.value = '';
  errorMessage.value = null;
  successMessage.value = null;
}

async function submit() {
  if (!sitemapUrl.value.trim()) {
    errorMessage.value = 'Sitemap URL is required';
    return;
  }
  submitting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    const result = await store.addSourcesFromSitemap(
      props.knowledgeId,
      sitemapUrl.value.trim(),
      urlPrefix.value.trim() || undefined,
    );
    successMessage.value = `Added ${result.added} of ${result.discovered} discovered URL${result.discovered === 1 ? '' : 's'}. Run Index to ingest into the knowledge base.`;
    emit('added');
    sitemapUrl.value = '';
    urlPrefix.value = '';
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Sitemap import failed';
  } finally {
    submitting.value = false;
  }
}

function cancel() {
  reset();
  open.value = false;
}
</script>

<template>
  <div class="rounded-md border bg-card p-4">
    <div v-if="!open" class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">
        Bulk-import every page from a sitemap.xml (or sitemap-index) as
        url-type sources.
      </p>
      <Button size="sm" variant="outline" @click="open = true">
        Add from sitemap
      </Button>
    </div>

    <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="grid gap-2">
        <Label for="sitemap-url">Sitemap URL</Label>
        <Input
          id="sitemap-url"
          v-model="sitemapUrl"
          placeholder="https://developer.paypal.com/sitemap.xml"
        />
      </div>

      <div class="grid gap-2">
        <Label for="sitemap-prefix">URL prefix filter (optional)</Label>
        <Input
          id="sitemap-prefix"
          v-model="urlPrefix"
          placeholder="https://developer.paypal.com/docs/checkout/"
        />
        <p class="text-xs text-muted-foreground">
          Only URLs starting with this prefix will be added. Leave empty to
          import every page in the sitemap.
        </p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">
        {{ errorMessage }}
      </p>
      <p v-if="successMessage" class="text-xs text-emerald-600">
        {{ successMessage }}
      </p>

      <div class="flex items-center gap-2">
        <Button type="submit" :disabled="submitting">
          {{ submitting ? 'Importing…' : 'Import' }}
        </Button>
        <Button type="button" variant="ghost" @click="cancel">Close</Button>
      </div>
    </form>
  </div>
</template>
