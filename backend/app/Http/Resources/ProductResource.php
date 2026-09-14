<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'category_id' => $this->category_id,
            'category' => new CategoryResource($this->whenLoaded('category')),
            'name' => $this->name,
            'sale_price' => (float) $this->sale_price,
            'stock' => (int) $this->stock,
            'min_stock' => (int) $this->min_stock,
            'image' => $this->image,
            'image_url' => $this->image
                ? (str_starts_with($this->image, 'http') ? $this->image : asset($this->image))
                : null,
            'is_active' => (bool) $this->is_active,
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
