<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\CategoryResource;
use App\Models\Category;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class CategoryController extends Controller
{
    public function index()
    {
        return CategoryResource::collection(
            Category::query()->latest()->get()
        );
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $this->validatedCategoryData($request);

        if ($request->hasFile('image')) {
            $path = $request->file('image')->store('categories', 'public');
            $validated['image'] = '/storage/'.$path;
        }

        $category = Category::create($validated);

        return (new CategoryResource($category))
            ->response()
            ->setStatusCode(201);
    }

    public function show(Category $category): CategoryResource
    {
        return new CategoryResource($category);
    }

    public function update(Request $request, Category $category): CategoryResource
    {
        $validated = $this->validatedCategoryData($request);

        if ($request->hasFile('image')) {
            $path = $request->file('image')->store('categories', 'public');
            $this->deleteCategoryImage($category);
            $validated['image'] = '/storage/'.$path;
        }

        $category->update($validated);

        return new CategoryResource($category);
    }

    public function destroy(Category $category): JsonResponse
    {
        $category->delete();
        $this->deleteCategoryImage($category);

        return response()->json([
            'message' => 'Category deleted successfully.',
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function validatedCategoryData(Request $request): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'image' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ]);

        if ($request->hasFile('image')) {
            unset($data['image']);
        }

        return $data;
    }

    private function deleteCategoryImage(Category $category): void
    {
        if (! $category->image || ! str_starts_with($category->image, '/storage/')) {
            return;
        }

        $path = str_replace('/storage/', '', $category->image);

        Storage::disk('public')->delete($path);
    }
}
