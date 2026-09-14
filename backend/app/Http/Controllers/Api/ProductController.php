<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ProductController extends Controller
{
    public function index()
    {
        return ProductResource::collection(
            Product::query()->with('category')->latest()->get()
        );
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validatedProductData($request);

        if ($request->hasFile('image')) {
            $path = $request->file('image')->store('products', 'public');
            $data['image'] = '/storage/'.$path;
        }

        $product = Product::create($data);

        return (new ProductResource($product->load('category')))
            ->response()
            ->setStatusCode(201);
    }

    public function show(Product $product): ProductResource
    {
        return new ProductResource($product->load('category'));
    }

    public function update(Request $request, Product $product): ProductResource
    {
        $data = $this->validatedProductData($request, updating: true);

        if ($request->hasFile('image')) {
            $path = $request->file('image')->store('products', 'public');
            $this->deleteProductImage($product);
            $data['image'] = '/storage/'.$path;
        }

        $product->update($data);

        return new ProductResource($product->load('category'));
    }

    public function destroy(Product $product): JsonResponse
    {
        try {
            $product->delete();
            $this->deleteProductImage($product);
        } catch (QueryException) {
            return response()->json([
                'message' => 'Product cannot be deleted because it has sales or stock movements.',
            ], 422);
        }

        return response()->json([
            'message' => 'Product deleted successfully.',
        ]);
    }

    public function lowStock()
    {
        return ProductResource::collection(
            Product::query()
                ->with('category')
                ->whereColumn('stock', '<=', 'min_stock')
                ->orderBy('stock')
                ->get()
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function validatedProductData(Request $request, bool $updating = false): array
    {
        $required = $updating ? 'sometimes' : 'required';

        $data = $request->validate([
            'category_id' => ['nullable', 'exists:categories,id'],
            'name' => [$required, 'string', 'max:255'],
            'sale_price' => [$required, 'numeric', 'min:0'],
            'stock' => ['nullable', 'integer', 'min:0'],
            'min_stock' => ['nullable', 'integer', 'min:0'],
            'image' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        if ($request->hasFile('image')) {
            unset($data['image']);
        }

        if (! $updating) {
            $data['purchase_price'] = 0;
            $data['stock'] = $data['stock'] ?? 0;
            $data['min_stock'] = $data['min_stock'] ?? 0;
            $data['is_active'] = $data['is_active'] ?? true;
        }

        foreach (['stock', 'min_stock'] as $field) {
            if (array_key_exists($field, $data) && $data[$field] === null) {
                $data[$field] = 0;
            }
        }

        return $data;
    }

    private function deleteProductImage(Product $product): void
    {
        if (! $product->image || ! str_starts_with($product->image, '/storage/')) {
            return;
        }

        $path = str_replace('/storage/', '', $product->image);

        Storage::disk('public')->delete($path);
    }
}
